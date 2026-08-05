"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { withRuntimeKeys, type RuntimeKeys } from "@/lib/runtime-keys";

import { db, userBusinesses } from "@/db";
import { getCurrentUser } from "@/lib/current-user";
import { createEmbedding } from "@/lib/embedding";
import { isAiEnabled } from "@/lib/env";
import { contentHash, normalizeWhitespace } from "@/lib/text";

export interface SaveBusinessInput {
  id?: string | null;
  title: string;
  description: string;
  region?: string | null;
  category?: string | null;
  businessAgeMonth?: number | null;
  keywords?: string[];
}

export interface SaveBusinessResult {
  ok: boolean;
  businessId?: string;
  embedded: boolean;
  error?: string;
}

/** 임베딩 원문 — 추천 품질은 이 문장 구성에 좌우된다 */
function buildEmbeddingSource(input: SaveBusinessInput): string {
  return normalizeWhitespace(
    [
      input.title,
      input.category ? `분야: ${input.category}` : null,
      input.region ? `지역: ${input.region}` : null,
      input.businessAgeMonth !== null && input.businessAgeMonth !== undefined
        ? `업력: ${input.businessAgeMonth}개월`
        : null,
      input.keywords?.length ? `키워드: ${input.keywords.join(", ")}` : null,
      input.description,
    ]
      .filter(Boolean)
      .join("\n\n"),
  );
}

export async function saveBusiness(
  input: SaveBusinessInput,
  keys?: RuntimeKeys,
): Promise<SaveBusinessResult> {
  return withRuntimeKeys(keys, () => saveBusinessInner(input));
}

async function saveBusinessInner(
  input: SaveBusinessInput,
): Promise<SaveBusinessResult> {
  const title = input.title?.trim() ?? "";
  const description = input.description?.trim() ?? "";

  if (title.length < 2) {
    return { ok: false, embedded: false, error: "사업명을 입력해 주세요." };
  }
  if (description.length < 30) {
    return {
      ok: false,
      embedded: false,
      error:
        "사업 설명을 30자 이상 적어 주세요. 구체적일수록 추천 정확도가 올라갑니다.",
    };
  }

  try {
    const user = await getCurrentUser();
    const values = {
      title,
      description,
      region: input.region?.trim() || null,
      category: input.category?.trim() || null,
      businessAgeMonth: input.businessAgeMonth ?? null,
      keywords: input.keywords?.filter(Boolean) ?? [],
    };

    const [business] = input.id
      ? await db
          .update(userBusinesses)
          .set(values)
          .where(eq(userBusinesses.id, input.id))
          .returning({
            id: userBusinesses.id,
            embeddingHash: userBusinesses.embeddingHash,
          })
      : await db
          .insert(userBusinesses)
          .values({ userId: user.id, ...values })
          .returning({
            id: userBusinesses.id,
            embeddingHash: userBusinesses.embeddingHash,
          });

    if (!business) {
      return {
        ok: false,
        embedded: false,
        error: "사업 프로필을 찾을 수 없습니다.",
      };
    }

    // 설명이 바뀌었으면 임베딩을 다시 만든다 (같으면 API 호출 없이 넘어간다)
    const source = buildEmbeddingSource({ ...input, title, description });
    const hash = contentHash(source);

    let embedded = false;
    if (isAiEnabled() && business.embeddingHash !== hash) {
      const vector = await createEmbedding(source);
      await db
        .update(userBusinesses)
        .set({ embedding: vector, embeddingHash: hash })
        .where(eq(userBusinesses.id, business.id));
      embedded = true;
    }

    revalidatePath("/business");
    revalidatePath("/recommendations");
    revalidatePath("/");

    return { ok: true, businessId: business.id, embedded };
  } catch (error) {
    return {
      ok: false,
      embedded: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
