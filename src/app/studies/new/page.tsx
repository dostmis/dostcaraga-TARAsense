import { CreateStudyBuilder } from "@/components/studies/create-study-builder";
import { requireRole } from "@/lib/auth/session";

export default async function CreateStudyPage() {
  await requireRole(["MSME", "ADMIN"]);
  return <CreateStudyBuilder />;
}
