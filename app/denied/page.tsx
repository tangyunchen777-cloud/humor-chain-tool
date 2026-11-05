import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/auth/actions";
export default async function DeniedPage() {
  const supabase = await createClient();
  const {data:{user}} = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return <main className="mx-auto max-w-lg px-6 py-28"><p className="eyebrow">Restricted workspace</p><h1 className="mt-5 text-4xl font-semibold tracking-tight">This account doesn’t have admin access.</h1><p className="mt-6 text-sm leading-7 text-stone-500">Sign in with an approved Google account. Access is assigned by the database owner; creating an account does not grant admin permission.</p><form action={signOut}><button className="btn btn-primary mt-8">Sign out and switch account</button></form></main>;
}
