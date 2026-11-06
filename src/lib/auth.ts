import NextAuth, { type DefaultSession } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { serverEnv } from '@/lib/env';
import { connectToDatabase } from '@/lib/mongodb';
import { User } from '@/lib/models/user';

/**
 * Operator authentication.
 *
 * The legacy app had no accounts: `/admin/*` was reachable by URL and
 * the only gate was a barcode string on the home screen. Sessions are
 * JWT-based so no adapter tables are required.
 */
declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      role: string;
    } & DefaultSession['user'];
  }

  interface User {
    role?: string;
  }
}

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: serverEnv.authTrustHost,
  secret: serverEnv.authSecret,
  session: { strategy: 'jwt', maxAge: 60 * 60 * 12 },
  pages: { signIn: '/admin/login' },
  providers: [
    Credentials({
      name: 'Operator',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const { email, password } = parsed.data;

        await connectToDatabase();
        const user = await User.findOne({ email: email.toLowerCase(), isActive: true })
          .select('+passwordHash')
          .lean();

        if (!user?.passwordHash) return null;

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return null;

        await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });

        return {
          id: String(user._id),
          email: user.email,
          name: user.name || user.email,
          role: user.role ?? 'operator',
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.role = user.role ?? 'operator';
        token.sub = user.id;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? '';
        session.user.role = (token.role as string) ?? 'operator';
      }
      return session;
    },
  },
});

export interface SessionUser {
  id: string;
  email: string;
  role: string;
}

/** Current operator, or null when signed out. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  if (!session?.user?.email) return null;
  return {
    id: session.user.id,
    email: session.user.email,
    role: session.user.role,
  };
}

export async function requireSessionUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new Error('UNAUTHORIZED');
  return user;
}
