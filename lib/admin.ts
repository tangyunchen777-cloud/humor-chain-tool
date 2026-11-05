import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";


// Request-scoped only. Every page and mutation calls this DAL, independently of layouts/proxy.
export const requireAdmin = cache(async () => {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect("/login");
  const { data: token } = await supabase.auth.getClaims();
  const amr: unknown = token?.claims?.amr;
  const oauth = Array.isArray(amr) && amr.some((entry: unknown) => typeof entry === "object" && entry !== null && "method" in entry && entry.method === "oauth");
  if (!oauth || !user.identities?.some(identity => identity.provider === "google")) redirect("/denied");
  const { data: profile, error: profileError } = await supabase.from("profiles")
    .select("id, first_name, last_name, is_superadmin").eq("id", user.id).single();
  if (profileError || !profile?.is_superadmin) redirect("/denied");
  return { supabase, user, profile };
});


