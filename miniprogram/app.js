App({
  globalData: {
    siteName: '小康康的物理世界',
    selectedItem: null,
    dataUpdatedAt: '',
    cloudSyncEnabled: false
  },

  onLaunch() {
    const account = wx.getAccountInfoSync ? wx.getAccountInfoSync() : null;
    this.globalData.isTouristPreview = !account || account.miniProgram.appId === 'touristappid';
  }
});
