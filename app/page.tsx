import Workspace from "@/components/Workspace";
import { configuredProviders } from "@/lib/ai/providers";

// Rendered on the server so the browser learns which providers have a key,
// never the keys themselves.
export const dynamic = "force-dynamic";

export default function Home() {
  return <Workspace configured={configuredProviders()} />;
}
