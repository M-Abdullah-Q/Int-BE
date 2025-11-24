-- CreateTable
CREATE TABLE "students" (
    "student_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "students_pkey" PRIMARY KEY ("student_id")
);

-- CreateTable
CREATE TABLE "daily_logs" (
    "log_id" SERIAL NOT NULL,
    "student_id" TEXT NOT NULL,
    "focus_minutes" INTEGER NOT NULL,
    "quiz_score" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_logs_pkey" PRIMARY KEY ("log_id")
);

-- CreateTable
CREATE TABLE "interventions" (
    "intervention_id" SERIAL NOT NULL,
    "student_id" TEXT NOT NULL,
    "task_assigned" BOOLEAN NOT NULL DEFAULT false,
    "assigned_tasks" TEXT,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interventions_pkey" PRIMARY KEY ("intervention_id")
);

-- CreateIndex
CREATE INDEX "daily_logs_student_id_timestamp_idx" ON "daily_logs"("student_id", "timestamp" DESC);

-- AddForeignKey
ALTER TABLE "daily_logs" ADD CONSTRAINT "daily_logs_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("student_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interventions" ADD CONSTRAINT "interventions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("student_id") ON DELETE CASCADE ON UPDATE CASCADE;
