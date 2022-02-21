const fs = require('fs');
const path = require('path');
const moment = require('moment');
const util = require('../libs/util');
const CronJob = require('cron').CronJob;
const Push = require('../common/Push');

const settingPath = path.join(__dirname, '../data/setting.json');
const torrentHistorySettingPath = path.join(__dirname, '../data/setting/torrent-history-setting.json');
const sitePushSettingPath = path.join(__dirname, '../data/setting/site-push-setting.json');

class SettingMod {
  get () {
    const settingStr = fs.readFileSync(settingPath, { encoding: 'utf-8' });
    return JSON.parse(settingStr);
  };

  getBackground () {
    const settingStr = fs.readFileSync(settingPath, { encoding: 'utf-8' });
    return JSON.parse(settingStr).background;
  };

  modify (options) {
    fs.writeFileSync(settingPath, JSON.stringify(options, null, 2));
    global.auth = {
      username: options.username || 'admin',
      password: options.password || '5f4dcc3b5aa765d61d8327deb882cf99'
    };
    global.userAgent = options.userAgent;
    global.telegramProxy = options.telegramProxy || 'https://api.telegram.org';
    return '修改全局设置成功, 刷新页面后更新。';
  };

  getTorrentHistorySetting () {
    const settingStr = fs.readFileSync(torrentHistorySettingPath, { encoding: 'utf-8' });
    return JSON.parse(settingStr);
  };

  modifyTorrentHistorySetting (options) {
    fs.writeFileSync(torrentHistorySettingPath, JSON.stringify(options, null, 2));
    return '修改成功';
  };

  getSitePushSetting () {
    const settingStr = fs.readFileSync(sitePushSettingPath, { encoding: 'utf-8' });
    return JSON.parse(settingStr);
  };

  modifySitePushSetting (options) {
    fs.writeFileSync(sitePushSettingPath, JSON.stringify(options, null, 2));
    if (global.sitePushJob) global.sitePushJob.stop();
    global.sitePushJob = new CronJob(options.cron, () => {
      const pushTo = util.listPush().filter(item => item.id === options.pushTo)[0] || {};
      pushTo.push = true;
      const push = new Push(pushTo);
      push.pushSiteData();
    });
    global.sitePushJob.start();
    return '修改成功';
  };

  async getRunInfo () {
    const { uploaded, downloaded } = (await util.getRecord('select sum(uploaded) as uploaded, sum(downloaded) as downloaded from torrents'));
    const { uploadedToday, downloadedToday } = (await util.getRecord('select sum(uploaded) as uploadedToday, sum(downloaded) as downloadedToday from torrents where add_time > ?', [moment().startOf('day').unix()]));
    const addCountToday = (await util.getRecord('select count(*) as addCount from torrents where uploaded != 0 and add_time > ?', [moment().startOf('day').unix()])).addCount;
    const rejectCountToday = (await util.getRecord('select count(*) as rejectCount from torrents where delete_time is null and add_time > ?', [moment().startOf('day').unix()])).rejectCount;
    const deleteCountToday = addCountToday;
    const addCount = (await util.getRecord('select count(*) as addCount from torrents where uploaded != 0')).addCount;
    const rejectCount = (await util.getRecord('select count(*) as rejectCount from torrents where delete_time is null')).rejectCount;
    const deleteCount = addCount;
    const perTracker = (await util.getRecords('select sum(uploaded) as uploaded, sum(downloaded) as downloaded, tracker from torrents  where tracker is not null group by tracker'));
    const perTrackerToday = (await util.getRecords('select sum(uploaded) as uploaded, sum(downloaded) as downloaded, tracker from torrents  where add_time > ? and tracker is not null group by tracker', [moment().startOf('day').unix()]));
    return {
      uploaded,
      downloaded,
      uploadedToday,
      downloadedToday,
      addCount,
      rejectCount,
      deleteCount,
      addCountToday,
      rejectCountToday,
      deleteCountToday,
      startTime: global.startTime,
      perTracker,
      perTrackerToday
    };
  }
}

module.exports = SettingMod;
