import { handleReceiptRequest } from '../../server/public-api.mjs';

export default { fetch(request) { return handleReceiptRequest(request); } };
