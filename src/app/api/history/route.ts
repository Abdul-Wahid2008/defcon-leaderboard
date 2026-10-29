import { safely } from '../../../lib/api';
import { getDeps } from '../../../lib/runtime';

export const dynamic = 'force-dynamic';

export const GET = (req: Request) => safely(req, 'history', getDeps);
export const HEAD = GET;
