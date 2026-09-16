import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createSession, hashPassword } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const { email, password } = await req.json();
  if (typeof email !== "string" || typeof password !== "string" || password.length < 8) {
    return NextResponse.json({ error: "email and a password of at least 8 characters are required" }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "an account with that email already exists" }, { status: 409 });
  }

  const user = await prisma.user.create({
    data: { email, passwordHash: hashPassword(password) },
  });
  await prisma.connection.create({
    data: { userId: user.id, provider: "CLOUDFLARE", status: "NOT_CONNECTED" },
  });

  await createSession(user.id);
  return NextResponse.json({ ok: true, userId: user.id });
}
