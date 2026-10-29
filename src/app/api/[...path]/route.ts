import { errorJson } from '../../../lib/api';

export const dynamic = 'force-dynamic';

// Any other /api path or method gets a minimal JSON body instead of the framework page.
const notFound = () => errorJson(404, 'not_found');
export const GET = notFound;
export const HEAD = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
export const OPTIONS = notFound;
