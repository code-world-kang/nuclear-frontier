const cloudConfig = require('./config/cloud');

App({
  globalData: {
    siteName: '小康康的物理世界',
    selectedItem: null,
    dataUpdatedAt: '',
    cloudSyncEnabled: false,
    cloudEnvId: cloudConfig.envId
  },

  onLaunch() {
    const account = wx.getAccountInfoSync ? wx.getAccountInfoSync() : null;
    this.globalData.isTouristPreview = !account || account.miniProgram.appId === 'touristappid';
    if (wx.cloud && cloudConfig.envId) {
      wx.cloud.init({ env: cloudConfig.envId, traceUser: true });
      this.globalData.cloudSyncEnabled = true;
    }
  }
});
