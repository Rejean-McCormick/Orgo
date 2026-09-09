import { HttpBridge } from '../http-bridge';
export class KonnaxionAdapter extends HttpBridge {
  constructor() {
    super(
      process.env.KONNAXION_BRIDGE_URL,
      process.env.KONNAXION_BRIDGE_TOKEN,
      ['publish', 'distribute'],
    );
  }
}
