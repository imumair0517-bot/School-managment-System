import { redirect } from "next/navigation";

// Phase 8's marketing/signup route group is built starting Milestone 1
// (Flow 1, the real signup form). For M0 the root simply routes into the
// login screen so there's something to click through end-to-end.
export default function RootPage() {
  redirect("/login");
}
