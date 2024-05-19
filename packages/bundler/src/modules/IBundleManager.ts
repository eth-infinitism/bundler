export interface IBundleManager {

  sendNextBundle: () => Promise<any>

  handlePastEvents: () => Promise<any>

}
