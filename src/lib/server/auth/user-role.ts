import { eq } from 'drizzle-orm';
import { authDb } from '$lib/server/db/auth-db';
import { user } from '$lib/server/db/auth.schema';

export type UserRole = 'user' | 'admin';

export async function getUserRole(userId: string): Promise<UserRole> {
	const [row] = await authDb
		.select({ role: user.role })
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);
	return row?.role === 'admin' ? 'admin' : 'user';
}

export async function isUserAdmin(userId: string): Promise<boolean> {
	return (await getUserRole(userId)) === 'admin';
}

export async function grantAdminByEmail(email: string): Promise<boolean> {
	const normalized = email.trim().toLowerCase();
	if (!normalized) return false;
	const rows = await authDb
		.update(user)
		.set({ role: 'admin' })
		.where(eq(user.email, normalized))
		.returning({ id: user.id });
	return rows.length > 0;
}
