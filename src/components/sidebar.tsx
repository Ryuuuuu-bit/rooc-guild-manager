import { signOut } from "@/auth";
import { AppIcon } from "@/components/shell/app-icon";

/** Sign-out as a Server Action form — rendered by the server layout and handed
 * to the client shell (sidebar footer on desktop, top bar on phones). */
export function SignOutButton() {
  return (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/login" });
      }}
    >
      <button type="submit" title="Sign out" aria-label="Sign out" className="flex rounded-md p-1.5 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-100">
        <AppIcon name="logout" size={17} />
      </button>
    </form>
  );
}
