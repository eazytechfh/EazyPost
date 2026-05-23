import { redirect } from "next/navigation";

export default function LogsRedirectPage() {
  redirect("/dashboard/logs");
}
