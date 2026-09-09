import { HttpBridge } from '../http-bridge';
export class KoaAdapter extends HttpBridge {
  constructor() {
    super(process.env.KOA_BRIDGE_URL, process.env.KOA_BRIDGE_TOKEN, [
      'execute',
    ]);
  }
}
