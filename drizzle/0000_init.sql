CREATE TYPE "public"."announcement_source" AS ENUM('K_STARTUP', 'EGBIZ', 'BIZINFO');--> statement-breakpoint
CREATE TYPE "public"."application_status" AS ENUM('SAVED', 'REVIEWED', 'WRITING', 'SUBMITTED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."eligibility_verdict" AS ENUM('MET', 'UNMET', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."ingestion_status" AS ENUM('RUNNING', 'SUCCESS', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."parse_status" AS ENUM('PENDING', 'PARSED', 'UNSUPPORTED', 'FAILED');--> statement-breakpoint
CREATE TABLE "announcement_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"announcement_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"file_url" text NOT NULL,
	"mime_type" text,
	"extracted_text" text,
	"parse_status" "parse_status" DEFAULT 'PENDING' NOT NULL,
	"parse_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" "announcement_source" NOT NULL,
	"external_id" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"summary" text,
	"url" text NOT NULL,
	"category" text,
	"region" text,
	"target_audience" text,
	"agency" text,
	"start_date" timestamp with time zone,
	"end_date" timestamp with time zone,
	"embedding" vector(1536),
	"embedding_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "application_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"section_key" text NOT NULL,
	"title" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"generated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "application_eligibility_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"requirement" text NOT NULL,
	"verdict" "eligibility_verdict" DEFAULT 'UNKNOWN' NOT NULL,
	"note" text,
	"order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "application_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"fit_score" integer NOT NULL,
	"summary" text NOT NULL,
	"strengths" text[] DEFAULT '{}'::text[] NOT NULL,
	"weaknesses" text[] DEFAULT '{}'::text[] NOT NULL,
	"action_items" text[] DEFAULT '{}'::text[] NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "application_reviews_applicationId_unique" UNIQUE("application_id")
);
--> statement-breakpoint
CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_business_id" uuid NOT NULL,
	"announcement_id" uuid NOT NULL,
	"status" "application_status" DEFAULT 'SAVED' NOT NULL,
	"memo" text,
	"similarity_at_save" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingestion_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" "announcement_source" NOT NULL,
	"status" "ingestion_status" DEFAULT 'RUNNING' NOT NULL,
	"fetched_count" integer DEFAULT 0 NOT NULL,
	"created_count" integer DEFAULT 0 NOT NULL,
	"updated_count" integer DEFAULT 0 NOT NULL,
	"embedded_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_businesses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"region" text,
	"category" text,
	"business_age_month" integer,
	"keywords" text[] DEFAULT '{}'::text[] NOT NULL,
	"embedding" vector(1536),
	"embedding_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "announcement_attachments" ADD CONSTRAINT "announcement_attachments_announcement_id_announcements_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."announcements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_drafts" ADD CONSTRAINT "application_drafts_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_eligibility_checks" ADD CONSTRAINT "application_eligibility_checks_review_id_application_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."application_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_reviews" ADD CONSTRAINT "application_reviews_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_user_business_id_user_businesses_id_fk" FOREIGN KEY ("user_business_id") REFERENCES "public"."user_businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_announcement_id_announcements_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."announcements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_businesses" ADD CONSTRAINT "user_businesses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "announcement_attachments_announcement_id_file_url_key" ON "announcement_attachments" USING btree ("announcement_id","file_url");--> statement-breakpoint
CREATE INDEX "announcement_attachments_parse_status_idx" ON "announcement_attachments" USING btree ("parse_status");--> statement-breakpoint
CREATE UNIQUE INDEX "announcements_source_external_id_key" ON "announcements" USING btree ("source","external_id");--> statement-breakpoint
CREATE INDEX "announcements_end_date_idx" ON "announcements" USING btree ("end_date");--> statement-breakpoint
CREATE INDEX "announcements_region_category_idx" ON "announcements" USING btree ("region","category");--> statement-breakpoint
CREATE INDEX "announcements_embedding_hnsw_idx" ON "announcements" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "announcements_title_trgm_idx" ON "announcements" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "application_drafts_application_id_section_key_key" ON "application_drafts" USING btree ("application_id","section_key");--> statement-breakpoint
CREATE INDEX "application_drafts_application_id_order_idx" ON "application_drafts" USING btree ("application_id","order");--> statement-breakpoint
CREATE INDEX "application_eligibility_checks_review_id_order_idx" ON "application_eligibility_checks" USING btree ("review_id","order");--> statement-breakpoint
CREATE UNIQUE INDEX "applications_user_business_id_announcement_id_key" ON "applications" USING btree ("user_business_id","announcement_id");--> statement-breakpoint
CREATE INDEX "applications_status_updated_at_idx" ON "applications" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "ingestion_runs_source_started_at_idx" ON "ingestion_runs" USING btree ("source","started_at");--> statement-breakpoint
CREATE INDEX "user_businesses_user_id_idx" ON "user_businesses" USING btree ("user_id");