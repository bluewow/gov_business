CREATE TABLE "application_strategies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"positioning" text NOT NULL,
	"evaluation_focus" text[] DEFAULT '{}'::text[] NOT NULL,
	"strategy_points" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"section_guides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "application_strategies_applicationId_unique" UNIQUE("application_id")
);
--> statement-breakpoint
ALTER TABLE "application_strategies" ADD CONSTRAINT "application_strategies_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;