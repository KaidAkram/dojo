import type { SvgComponent } from "astro/types"
import GitHub from "@/assets/icons/github.svg"
import Telegram from "@/assets/icons/telegram.svg"
import LinkedIn from "@/assets/icons/linkedin.svg"
import Discord from "@/assets/icons/discord.svg"
import RSS from "@/assets/icons/rss.svg"

export const SITE = {
  title: "0xAkr4m",
  description:
    "Red Teamer. AI Security Enthusiast. Walking the path of the sword through cyberspace.",
  locale: "en-US",
  dir: "ltr",
  defaultPageImage: "/static/opengraph-image.png",
  defaultPostImage: "/static/1200x630.png",
} as const

export const NAVIGATION = [
  { href: import.meta.env.BASE_URL, label: "Home" },
  { href: `${import.meta.env.BASE_URL.replace(/\/$/, '')}/blog`, label: "Blogs" },
  { href: `${import.meta.env.BASE_URL.replace(/\/$/, '')}/about`, label: "About" },
  { href: "https://github.com/KaidAkram/dojo", label: "Source" },
]

export const SOCIALS: { href: string; label: string; icon: SvgComponent }[] = [
  { href: "https://github.com/KaidAkram", label: "GitHub", icon: GitHub },
  { href: "https://t.me/akramkd17", label: "Telegram", icon: Telegram },
  {
    href: "https://www.linkedin.com/in/akram-kaid/",
    label: "LinkedIn",
    icon: LinkedIn,
  },
  { href: "https://discord.com/users/akramkaid_27366", label: "Discord", icon: Discord },
  { href: "/rss.xml", label: "RSS", icon: RSS },
]
