import type { Metadata } from "next";
import { ChogProvider } from "../components/chog-provider";
import { SiteShell } from "../components/site-shell";
import "./styles.css";

export const metadata: Metadata = {
  title: {
    default: "CHOG — Born different. Built to evolve.",
    template: "%s · CHOG Evolution",
  },
  description:
    "Meet your Chog. Explore the Monad ecosystem, take on quests, and grow a collectible with a story that is entirely yours.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <ChogProvider>
          <SiteShell>{children}</SiteShell>
        </ChogProvider>
      </body>
    </html>
  );
}
