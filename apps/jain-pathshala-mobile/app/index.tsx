import { Redirect } from "expo-router";
import { useAuth } from "@/contexts/AuthContext";
import { routeForRole } from "@/lib/roles";

/**
 * Entry point. Sends each user to their persona home; unauthenticated visitors
 * land on the guest experience (they can browse, then sign in).
 */
export default function Index() {
  const { user, loading } = useAuth();
  if (loading) return null;
  return <Redirect href={routeForRole(user?.role)} />;
}
