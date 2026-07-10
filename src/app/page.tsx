import { Suspense } from "react";
import { CreateStudio } from "@/components/create-studio";

export default function CreatePage() {
  return <Suspense fallback={<div className="create-loading">Opening workspace...</div>}><CreateStudio /></Suspense>;
}
