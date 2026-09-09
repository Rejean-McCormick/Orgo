import { HttpBridge } from '../http-bridge';
export class KristalAdapter extends HttpBridge {
  constructor() {
    super(process.env.KRISTAL_BRIDGE_URL, process.env.KRISTAL_BRIDGE_TOKEN, [
      'validate',
    ]);
  }
}
