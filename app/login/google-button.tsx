"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
export function GoogleButton() {
  const [pending,setPending] = useState(false);
  const [error,setError] = useState("");
  async function login() {
    setPending(true); setError("");
    try {
      const { error } = await createClient().auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${window.location.origin}/auth/callback` } });
      if (error) throw error;
    } catch { setPending(false); setError("Sign-in could not start. Please try again."); }
  }
  return <><button className="btn btn-primary mt-8 w-full py-4" disabled={pending} onClick={login}><span aria-hidden="true" className="flex h-6 w-6 items-center justify-center rounded-full bg-white font-bold text-[#4285f4]">G</span>{pending ? "Connecting…" : "Continue with Google"}</button>{error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}</>;
}
