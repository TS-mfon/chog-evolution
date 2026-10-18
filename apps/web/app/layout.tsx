import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "CHOG Evolution — Evolution Lab",
  description: "A living record of your Chog ecosystem journey.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
