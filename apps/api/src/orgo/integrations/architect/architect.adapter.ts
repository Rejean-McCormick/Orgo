import { HttpBridge } from '../http-bridge';
export class ArchitectAdapter extends HttpBridge {
  constructor() {
    super(
      process.env.ARCHITECT_BRIDGE_URL,
      process.env.ARCHITECT_BRIDGE_TOKEN,
      ['generate'],
    );
  }
}
