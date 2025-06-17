"use server";

import { encodedRedirect } from "@/utils/utils";
import { createClient } from "@/utils/supabase/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export const signUpAction = async (formData: FormData) => {
  const email = formData.get("email")?.toString();
  const password = formData.get("password")?.toString();
  const supabase = await createClient();

  if (!email || !password) {
    return encodedRedirect(
      "error",
      "/sign-up",
      "Email and password are required",
    );
  }

  // First, try to sign up the user
  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: undefined, // Explicitly disable email verification
    },
  });

  if (signUpError) {
    console.error(signUpError.code + " " + signUpError.message);
    return encodedRedirect("error", "/sign-up", signUpError.message);
  }

  // Immediately try to sign in the user (this works even if email confirmation is enabled)
  const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (signInError) {
    // If sign in fails, it might be due to email confirmation
    if (signInError.message.includes("Email not confirmed")) {
      return encodedRedirect(
        "error",
        "/sign-up",
        "Account created but email confirmation is required. Please check your email or contact support.",
      );
    }
    return encodedRedirect("error", "/sign-up", signInError.message);
  }

  // If we get here, the user is signed up and signed in successfully
  return redirect("/");
};

export const signInAction = async (formData: FormData) => {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return encodedRedirect("error", "/sign-in", error.message);
  }

  return redirect("/");
};

export const forgotPasswordAction = async (formData: FormData) => {
  const email = formData.get("email")?.toString();
  const supabase = await createClient();
  const origin = (await headers()).get("origin");
  const callbackUrl = formData.get("callbackUrl")?.toString();

  if (!email) {
    return encodedRedirect("error", "/forgot-password", "Email is required");
  }

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?redirect_to=/protected/reset-password`,
  });

  if (error) {
    console.error(error.message);
    return encodedRedirect(
      "error",
      "/forgot-password",
      "Could not reset password",
    );
  }

  if (callbackUrl) {
    return redirect(callbackUrl);
  }

  return encodedRedirect(
    "success",
    "/forgot-password",
    "Check your email for a link to reset your password.",
  );
};

export const resetPasswordAction = async (formData: FormData) => {
  const supabase = await createClient();

  const password = formData.get("password") as string;
  const confirmPassword = formData.get("confirmPassword") as string;

  if (!password || !confirmPassword) {
    encodedRedirect(
      "error",
      "/protected/reset-password",
      "Password and confirm password are required",
    );
  }

  if (password !== confirmPassword) {
    encodedRedirect(
      "error",
      "/protected/reset-password",
      "Passwords do not match",
    );
  }

  const { error } = await supabase.auth.updateUser({
    password: password,
  });

  if (error) {
    encodedRedirect(
      "error",
      "/protected/reset-password",
      "Password update failed",
    );
  }

  encodedRedirect("success", "/protected/reset-password", "Password updated");
};

export const signOutAction = async () => {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return redirect("/sign-in");
};

export const submitFeedbackAction = async (formData: FormData) => {
  const name = formData.get("name")?.toString() || "Anonymous"; // Default to Anonymous if no name
  const email = formData.get("email")?.toString();
  const type = formData.get("type")?.toString();
  const message = formData.get("message")?.toString();

  if (!email || !type || !message) {
    return { error: "Email, feedback type, and message are required" };
  }

  try {
    const supabase = await createClient();
    
    // Get current user if authenticated
    const { data: { user } } = await supabase.auth.getUser();
    
    // Insert feedback into database
    const { error } = await supabase
      .from('feedback')
      .insert([{ 
        name, 
        email, 
        type, 
        message,
        user_id: user?.id || null // Associate with user if logged in
      }]);
    
    if (error) {
      console.error("Supabase error:", error);
      return { error: "Failed to submit feedback. Please try again." };
    }

    return { success: "Thank you for your feedback!" };
  } catch (error) {
    console.error("Unexpected error:", error);
    return { error: "Something went wrong. Please try again." };
  }
};
