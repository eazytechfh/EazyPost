import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PostGPWA",
  description: "Gestao de anuncios de veiculos para grupos de WhatsApp"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
