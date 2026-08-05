CREATE TABLE "llm_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_business_id" uuid NOT NULL,
	"announcement_id" uuid NOT NULL,
	"score" integer NOT NULL,
	"reason" text NOT NULL,
	"business_hash" text NOT NULL,
	"announcement_hash" text NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "llm_evaluations" ADD CONSTRAINT "llm_evaluations_user_business_id_user_businesses_id_fk" FOREIGN KEY ("user_business_id") REFERENCES "public"."user_businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_evaluations" ADD CONSTRAINT "llm_evaluations_announcement_id_announcements_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."announcements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "llm_evaluations_business_announcement_key" ON "llm_evaluations" USING btree ("user_business_id","announcement_id");