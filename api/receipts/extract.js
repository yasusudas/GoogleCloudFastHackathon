import { handleReceiptRequest } from '../../server/public-api.mjs';

export const maxDuration = 90;
export default { fetch: handleReceiptRequest };
