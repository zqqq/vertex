const parser = require('xml2js').parseString;
const crypto = require('crypto');
const moment = require('moment');
const path = require('path');
const fs = require('fs');
const bencode = require('bencode');
const util = require('./util');
const redis = require('./redis');
const logger = require('./logger');

const parseXml = util.promisify(parser);

const _getSum = function (a, b) {
  return a + b;
};

const _getRssContent = async function (rssUrl, suffix = true) {
  let body;
  const cache = await redis.get(`vertex:rss:${rssUrl}`);
  if (cache) {
    body = cache;
  } else {
    let url = rssUrl;
    if (suffix) {
      url += (rssUrl.indexOf('?') === -1 ? '?' : '&') + '____=' + Math.random();
    }
    let res;
    if (rssUrl.includes('https://pt.soulvoice.club/') && global.runningSite.SoulVoice) {
      res = await util.requestPromise({
        url,
        headers: {
          cookie: global.runningSite.SoulVoice.cookie
        }
      }, true);
    } else {
      res = await util.requestPromise(url, true);
    }
    body = res.body;
    const isHTML = body.indexOf('xml-viewer-style') !== -1;
    if (isHTML) {
      body = '<?xml version="1.0" encoding="utf-8"?>\n' + res.body.match(/<rss[\s\S]*<\/rss>/)[0];
    }
    const host = new URL(rssUrl).host;
    const cacheTime = ['lemon', 'hhanclub'].some(item => host.indexOf(item) !== -1) ? 150 : 40;
    await redis.setWithExpire(`vertex:rss:${rssUrl}`, body, isHTML ? 290 : cacheTime);
  }
  return body;
};

const _getTorrents = async function (rssUrl) {
  const rss = await parseXml(await _getRssContent(rssUrl));
  const torrents = [];
  let items = rss.rss.channel[0].item;
  if (['chdbits', 'totheglory'].some(item => rssUrl.indexOf(item) !== -1)) {
    items = items.slice(0, 10);
  }
  for (let i = 0; i < items.length; ++i) {
    const torrent = {
      size: 0,
      name: '',
      hash: '',
      id: 0,
      url: '',
      link: ''
    };
    torrent.size = items[i].enclosure[0].$.length;
    torrent.name = items[i].title[0];
    const link = items[i].link[0];
    torrent.link = link;
    torrent.id = link.substring(link.indexOf('?id=') + 4);
    torrent.url = items[i].enclosure[0].$.url;
    torrent.hash = items[i].guid[0]._ || items[i].guid[0];
    if (['chdbits', 'totheglory'].some(item => torrent.url.indexOf(item) !== -1)) {
      const cache = await redis.get(`vertex:hash:${torrent.url}`);
      if (cache) {
        torrent.hash = cache;
      } else {
        try {
          const { hash } = await exports.getTorrentNameByBencode(torrent.url);
          torrent.hash = hash;
          await redis.set(`vertex:hash:${torrent.url}`, hash);
        } catch (e) {
          await redis.set(`vertex:hash:${torrent.url}`, 'chd' + moment().unix() + 'chd');
          throw e;
        }
      }
    }
    torrent.pubTime = moment(items[i].pubDate[0]).unix();
    torrents.push(torrent);
  }
  return torrents;
};

const _getTorrentsPuTao = async function (rssUrl) {
  const rss = await parseXml(await _getRssContent(rssUrl));
  const torrents = [];
  const items = rss.rss.channel[0].item;
  for (let i = 0; i < items.length; ++i) {
    const torrent = {
      size: 0,
      name: '',
      hash: '',
      id: 0,
      url: '',
      link: ''
    };
    const size = items[i].title[0].match(/\[\d+\.\d+ [KMGT]B\]/)[0]?.match(/\d+\.\d+ [KMGT]B/)[0];
    const map = {
      KB: 1000,
      MB: 1000 * 1000,
      GB: 1000 * 1000 * 1000,
      TB: 1000 * 1000 * 1000 * 1000
    };
    torrent.size = size.match(/(\d*\.\d*|\d*) (GB|MB|TB|KB)/);
    torrent.size = parseFloat(torrent.size[1]) * map[torrent.size[2]];
    torrent.name = items[i].title[0];
    const link = items[i].link[0];
    torrent.link = link.substring(0, link.indexOf('&passkey='));
    torrent.id = torrent.link.substring(link.indexOf('?id=') + 4);
    torrent.url = link;
    torrent.hash = items[i].guid[0]._ || items[i].guid[0];
    torrent.pubTime = moment(items[i].pubDate[0]).unix();
    torrents.push(torrent);
  }
  return torrents;
};

const _getTorrentsFileList = async function (rssUrl) {
  const rss = await parseXml(await _getRssContent(rssUrl));
  const torrents = [];
  const items = rss.rss.channel[0].item;
  for (let i = 0; i < items.length; ++i) {
    const torrent = {
      size: 0,
      name: '',
      hash: '',
      id: 0,
      url: '',
      link: ''
    };
    const size = items[i].description[0].match(/Size: (\d*\.\d*|\d*) (GB|MB|TB|KB)/)[0];
    const map = {
      KB: 1000,
      MB: 1000 * 1000,
      GB: 1000 * 1000 * 1000,
      TB: 1000 * 1000 * 1000 * 1000
    };
    const regRes = size.match(/Size: (\d*\.\d*|\d*) (GB|MB|TB|KB)/);
    torrent.size = parseFloat(regRes[1]) * map[regRes[2]];
    torrent.name = items[i].title[0].replace(/\n/, ' ');
    const link = items[i].link[0].match(/https:\/\/filelist.io\/download\.php\?id=\d*/)[0].replace('download', 'detailes');
    torrent.link = link;
    torrent.id = link.substring(link.indexOf('?id=') + 4);
    torrent.hash = 'fakehash' + torrent.id + 'fakehash';
    torrent.url = items[i].link[0];
    torrents.push(torrent);
  }
  return torrents;
};

const _getTorrentsBeyondHD = async function (rssUrl) {
  const rss = await parseXml(await _getRssContent(rssUrl));
  const torrents = [];
  const items = rss.rss.channel[0].item;
  for (let i = 0; i < items.length; ++i) {
    const torrent = {
      size: 0,
      name: '',
      hash: '',
      id: 0,
      url: '',
      link: ''
    };
    const size = items[i].title[0].match(/(\d*\.\d*|\d*) (GiB|MiB|TiB|KiB)/)[0];
    const map = {
      KiB: 1024,
      MiB: 1024 * 1024,
      GiB: 1024 * 1024 * 1024,
      TiB: 1024 * 1024 * 1024 * 1024
    };
    const regRes = size.match(/(\d*\.\d*|\d*) (GiB|MiB|TiB|KiB)/);
    torrent.size = parseFloat(regRes[1]) * map[regRes[2]];
    torrent.name = items[i].title[0].split('\n')[0];
    torrent.link = items[i].guid[0];
    torrent.id = torrent.link.match(/\.(\d+)/)[1];
    torrent.hash = 'fakehash' + torrent.id + 'fakehash';
    torrent.url = items[i].link[0];
    torrents.push(torrent);
  }
  return torrents;
};

const _getTorrentsUnit3D2 = async function (rssUrl) {
  const rss = await parseXml(await _getRssContent(rssUrl));
  const torrents = [];
  const items = rss.rss.channel[0].item;
  for (let i = 0; i < items.length; ++i) {
    const torrent = {
      size: 0,
      name: '',
      hash: '',
      id: 0,
      url: '',
      link: ''
    };
    const size = items[i].description[0].match(/Size<\/strong>: (\d*\.\d*|\d*).(GiB|MiB|TiB|KiB)/)[0];
    const map = {
      KiB: 1024,
      MiB: 1024 * 1024,
      GiB: 1024 * 1024 * 1024,
      TiB: 1024 * 1024 * 1024 * 1024
    };
    const regRes = size.match(/Size<\/strong>: (\d*\.\d*|\d*).(GiB|MiB|TiB|KiB)/);
    torrent.size = parseFloat(regRes[1]) * map[regRes[2]];
    torrent.name = items[i].title[0];
    const link = items[i].link[0];
    torrent.id = link.match(/download\/(\d*)\./)[1];
    torrent.hash = 'fakehash' + torrent.id + 'fakehash';
    torrent.url = link;
    torrent.link = link.replace(/download\//, '').replace(/(\d+)\..*/, '$1');
    torrents.push(torrent);
  }
  return torrents;
};

const _getTorrentsUnit3D = async function (rssUrl) {
  const rss = await parseXml(await _getRssContent(rssUrl));
  const torrents = [];
  const items = rss.rss.channel[0].item;
  for (let i = 0; i < items.length; ++i) {
    const torrent = {
      size: 0,
      name: '',
      hash: '',
      id: 0,
      url: '',
      link: ''
    };
    const size = items[i].description[0].match(/Size<\/strong>: (\d*\.\d*|\d*) (GiB|MiB|TiB|KiB)/)[0];
    const map = {
      KiB: 1024,
      MiB: 1024 * 1024,
      GiB: 1024 * 1024 * 1024,
      TiB: 1024 * 1024 * 1024 * 1024
    };
    const regRes = size.match(/Size<\/strong>: (\d*\.\d*|\d*) (GiB|MiB|TiB|KiB)/);
    torrent.size = parseFloat(regRes[1]) * map[regRes[2]];
    torrent.name = items[i].title[0];
    const link = items[i].link[0];
    torrent.link = link;
    torrent.id = link.match(/torrents\/(\d*)/)[1];
    torrent.hash = 'fakehash' + torrent.id + 'fakehash';
    torrent.url = items[i].enclosure[0].$.url;
    torrents.push(torrent);
  }
  return torrents;
};

const _getTorrentsTorrentDB = async function (rssUrl) {
  const rss = await parseXml(await _getRssContent(rssUrl));
  const torrents = [];
  const items = rss.rss.channel[0].item;
  for (let i = 0; i < items.length; ++i) {
    const torrent = {
      size: 0,
      name: '',
      hash: '',
      id: 0,
      url: '',
      link: ''
    };
    const size = items[i].description[0].match(/(\d*\.\d*|\d*) (GB|MB|TB|KB)/)[0];
    const map = {
      KB: 1000,
      MB: 1000 * 1000,
      GB: 1000 * 1000 * 1000,
      TB: 1000 * 1000 * 1000 * 1000
    };
    const regRes = size.match(/(\d*\.\d*|\d*) (GB|MB|TB|KB)/);
    torrent.size = parseFloat(regRes[1]) * map[regRes[2]];
    torrent.name = items[i].title[0];
    const link = items[i].comments[0];
    torrent.link = link;
    torrent.hash = items[i].guid[0];
    torrent.url = items[i].persistentlink[0];
    torrents.push(torrent);
  }
  return torrents;
};

const _getTorrentsUHDBits = async function (rssUrl) {
  const rss = await parseXml(await _getRssContent(rssUrl));
  const torrents = [];
  const items = rss.rss.channel[0].item;
  for (let i = 0; i < items.length; ++i) {
    const torrent = {
      size: 0,
      name: '',
      hash: '',
      id: 0,
      url: '',
      link: ''
    };
    torrent.name = items[i].title[0];
    const link = items[i].comments[0];
    torrent.link = link;
    torrent.url = items[i].link[0];
    torrent.id = +torrent.url.match(/id=(\d+)/)[1];
    const cache = await redis.get(`vertex:hash:${torrent.url}`);
    if (cache) {
      const _torrent = JSON.parse(cache);
      torrent.hash = _torrent.hash;
      torrent.size = _torrent.size;
    } else {
      try {
        const { hash, size } = await exports.getTorrentNameByBencode(torrent.url);
        torrent.hash = hash;
        torrent.size = size;
        await redis.set(`vertex:hash:${torrent.url}`, JSON.stringify(torrent));
      } catch (e) {
        await redis.set(`vertex:hash:${torrent.url}`, JSON.stringify({ hash: 'uhd' + moment().unix() + 'uhd', size: 0 }));
        throw e;
      }
    }
    torrents.push(torrent);
  }
  return torrents;
};

const _getTorrentsEmpornium = async function (rssUrl) {
  const rss = await parseXml(await _getRssContent(rssUrl));
  const torrents = [];
  const items = rss.rss.channel[0].item;
  for (let i = 0; i < items.length; ++i) {
    const torrent = {
      size: 0,
      name: '',
      hash: '',
      id: 0,
      url: '',
      link: ''
    };
    torrent.name = items[i].title[0];
    const link = items[i].link[0];
    torrent.link = link;
    torrent.id = link.substring(link.indexOf('?id=') + 4);
    torrent.url = items[i].enclosure[0].$.url;
    const cache = await redis.get(`vertex:hash:${torrent.url}`);
    if (cache) {
      const _torrent = JSON.parse(cache);
      torrent.hash = _torrent.hash;
      torrent.size = _torrent.size;
    } else {
      try {
        const { hash, size } = await exports.getTorrentNameByBencode(torrent.url);
        torrent.hash = hash;
        torrent.size = size;
        await redis.set(`vertex:hash:${torrent.url}`, JSON.stringify(torrent));
      } catch (e) {
        await redis.set(`vertex:hash:${torrent.url}`, JSON.stringify({ hash: 'emp' + moment().unix() + 'emp', size: 0 }));
        throw e;
      }
    }
    torrent.pubTime = moment(items[i].pubDate[0]).unix();
    torrents.push(torrent);
  }
  return torrents;
};

const _getTorrentsSkyeySnow = async function (rssUrl) {
  const rss = await parseXml(await _getRssContent(rssUrl));
  const torrents = [];
  const items = rss.rss.channel[0].item;
  for (let i = 0; i < items.length; ++i) {
    const torrent = {
      size: 0,
      name: '',
      hash: '',
      id: 0,
      url: '',
      link: ''
    };
    torrent.size = items[i].enclosure[0].$.length;
    torrent.name = items[i].title[0];
    const link = items[i].link[0];
    torrent.link = link;
    torrent.id = link.substring(link.indexOf('?id=') + 4);
    torrent.url = items[i].enclosure[0].$.url;
    if (torrent.url.indexOf('skyey') !== -1) {
      const cache = await redis.get(`vertex:hash:${torrent.url}`);
      if (cache) {
        torrent.hash = cache;
      } else {
        try {
          const { hash } = await exports.getTorrentNameByBencode(torrent.url);
          torrent.hash = hash;
          await redis.set(`vertex:hash:${torrent.url}`, hash);
        } catch (e) {
          await redis.set(`vertex:hash:${torrent.url}`, 'skyey' + moment().unix() + 'skyey');
          throw e;
        }
      }
    }
    torrent.pubTime = moment(items[i].pubDate[0]).unix();
    torrents.push(torrent);
  }
  return torrents;
};

const _getTorrentsHDBits = async function (rssUrl) {
  const rss = await parseXml(await _getRssContent(rssUrl));
  const torrents = [];
  const items = rss.rss.channel[0].item;
  for (let i = 0; i < items.length; ++i) {
    const torrent = {
      size: 0,
      name: '',
      hash: '',
      id: 0,
      url: '',
      link: ''
    };
    torrent.name = items[i].title[0];
    const url = items[i].link[0];
    torrent.id = url.match(/id=(\d+)/)[1];
    torrent.url = url;
    torrent.link = `https://hdbits.org/details.php?id=${torrent.id}&source=browse`;
    if (torrent.url.indexOf('hdbits') !== -1) {
      const cache = await redis.get(`vertex:hash:${torrent.url}`);
      if (cache) {
        torrent.hash = cache;
      } else {
        try {
          const { hash, size } = await exports.getTorrentNameByBencode(torrent.url);
          torrent.hash = hash;
          torrent.size = size;
          await redis.set(`vertex:hash:${torrent.url}`, JSON.stringify(torrent));
        } catch (e) {
          await redis.set(`vertex:hash:${torrent.url}`, JSON.stringify({ hash: 'hdbits' + moment().unix() + 'hdbits', size: 0 }));
          throw e;
        }
      }
    }
    torrent.pubTime = moment(items[i].pubDate[0]).unix();
    torrents.push(torrent);
  }
  return torrents;
};

const _getTorrentsHDTorrents = async function (rssUrl) {
  const rss = await parseXml(await _getRssContent(rssUrl));
  const torrents = [];
  const items = rss.rss.channel[0].item;
  for (let i = 0; i < items.length; ++i) {
    const torrent = {
      size: 0,
      name: '',
      hash: '',
      id: 0,
      url: '',
      link: ''
    };
    torrent.name = items[i].title[0];
    const link = items[i].link[0];
    torrent.link = link;
    torrent.id = moment().unix();
    torrent.url = link;
    torrent.hash = link.match(/hash=(.*?)&/)[1];
    torrent.pubTime = moment(items[i].pubDate[0]).unix();
    torrents.push(torrent);
  }
  return torrents;
};

const _getTorrentsHDCity = async function (rssUrl) {
  const rss = await parseXml(await _getRssContent(rssUrl));
  const torrents = [];
  const items = rss.rss.channel[0].item;
  for (let i = 0; i < items.length; ++i) {
    const torrent = {
      size: 0,
      name: '',
      hash: '',
      id: 0,
      url: '',
      link: ''
    };
    torrent.size = items[i].enclosure[0].$.length;
    torrent.name = items[i].title[0];
    const link = items[i].link[0];
    torrent.id = link.substring(link.indexOf('?t=') + 3);
    torrent.link = 'https://hdcity.leniter.org/t-' + torrent.id;
    torrent.url = items[i].enclosure[0].$.url;
    torrent.hash = 'fakehash' + torrent.id + 'fakehash';
    torrents.push(torrent);
  }
  return torrents;
};

const _getTorrentsIPTorrents = async function (rssUrl) {
  const rss = await parseXml(await _getRssContent(rssUrl));
  const torrents = [];
  const items = rss.rss.channel[0].item;
  for (let i = 0; i < items.length; ++i) {
    const torrent = {
      size: 0,
      name: '',
      hash: '',
      id: 0,
      url: '',
      link: ''
    };
    const size = items[i].description[0].split(';')[0].replace('B', 'iB');
    torrent.size = util.calSize(...size.split(' '));
    torrent.name = items[i].title[0];
    const link = items[i].link[0];
    torrent.id = link.match(/\/(\d+)\//)[1];
    torrent.link = link;
    torrent.url = items[i].link[0];
    torrent.hash = 'fakehashipt' + torrent.id + 'fakehashipt';
    torrent.pubTime = moment(items[i].pubDate[0]).unix();
    torrents.push(torrent);
  }
  return torrents;
};

const _getTorrentsMikanProject = async function (rssUrl) {
  const rss = await parseXml(await _getRssContent(rssUrl));
  const torrents = [];
  const items = rss.rss.channel[0].item;
  if (!items) return [];
  for (let i = 0; i < items.length; ++i) {
    const torrent = {
      size: 0,
      name: '',
      hash: '',
      id: 0,
      url: '',
      link: ''
    };
    torrent.size = items[i].enclosure[0].$.length;
    torrent.name = items[i].title[0];
    const link = items[i].link[0];
    torrent.link = link;
    torrent.id = link.substring(link.indexOf('Episode/') + 8);
    torrent.url = items[i].enclosure[0].$.url;
    torrent.hash = torrent.id;
    torrent.pubTime = moment(items[i].torrent[0].pubDate[0]).unix();
    torrents.push(torrent);
  }
  return torrents;
};

const _getTorrentsLearnFlakes = async function (rssUrl) {
  const rss = await parseXml(await _getRssContent(rssUrl, false));
  const torrents = [];
  const items = rss.rss.channel[0].item;
  for (let i = 0; i < items.length; ++i) {
    const torrent = {
      size: 0,
      name: '',
      hash: '',
      id: 0,
      url: '',
      link: ''
    };
    torrent.size = items[i].description[0].match(/\d+\.\d+ [MGKT]B/);
    if (torrent.size) {
      torrent.size = util.calSize(...torrent.size[0].replace(/([MGKT])B/, '$1iB').split(' '));
    } else {
      torrent.size = 0;
    }
    torrent.name = items[i].title[0];
    const link = items[i].link[0];
    torrent.link = link;
    torrent.id = link.match(/&tid=(\d+)/)[1];
    torrent.url = items[i].guid[0]._;
    torrent.hash = 'learnflakes' + torrent.id + 'learnflakes';
    torrent.pubTime = moment(items[i].pubDate[0]).unix();
    torrents.push(torrent);
  }
  return torrents;
};

const _getTorrentsExoticaZ = async function (rssUrl) {
  const rss = await parseXml(await _getRssContent(rssUrl));
  const torrents = [];
  const items = rss.rss.channel[0].item;
  for (let i = 0; i < items.length; ++i) {
    const torrent = {
      size: 0,
      name: '',
      hash: '',
      id: 0,
      url: '',
      link: ''
    };
    const size = items[i].description[0].match(/Size<\/strong>: (\d*\.\d*|\d*) (GB|MB|TB|KB)/)[0].replace(/([GMTK])B/, '$1iB');
    const map = {
      KiB: 1024,
      MiB: 1024 * 1024,
      GiB: 1024 * 1024 * 1024,
      TiB: 1024 * 1024 * 1024 * 1024
    };
    const regRes = size.match(/Size<\/strong>: (\d*\.\d*|\d*) (GiB|MiB|TiB|KiB)/);
    torrent.size = parseFloat(regRes[1]) * map[regRes[2]];
    torrent.name = items[i].title[0];
    const link = items[i].link[0];
    torrent.link = link;
    torrent.id = link.match(/torrent\/(\d+)/)[1];
    torrent.url = items[i].enclosure[0].$.url;
    torrent.hash = items[i].guid[0]._.match(/-(.*)/)[1];
    torrent.pubTime = moment(items[i].pubDate[0]).unix();
    torrents.push(torrent);
  }
  return torrents;
};

const _getTorrentsTorrentLeech = async function (rssUrl) {
  const rss = await parseXml(await _getRssContent(rssUrl));
  const torrents = [];
  const items = rss.rss.channel[0].item;
  for (let i = 0; i < items.length; ++i) {
    const torrent = {
      size: 0,
      name: '',
      hash: '',
      id: 0,
      url: '',
      link: ''
    };
    const guid = items[i].guid[0]._ || items[i].guid[0];
    torrent.size = 0;
    torrent.name = items[i].title[0];
    torrent.url = items[i].link[0];
    torrent.link = guid;
    torrent.id = guid.substring(torrent.hash.indexOf('torrent/') + 8);
    torrent.hash = 'fakehash' + torrent.id + 'fakehash';
    torrent.pubTime = moment(items[i].pubDate[0]).unix();
    torrents.push(torrent);
  }
  return torrents;
};

const _getTorrentsFSM = async function (rssUrl) {
  const rss = await parseXml(await _getRssContent(rssUrl));
  const torrents = [];
  const items = rss.rss.channel[0].item;
  for (let i = 0; i < items.length; ++i) {
    const torrent = {
      size: 0,
      name: '',
      hash: '',
      id: 0,
      url: '',
      link: ''
    };
    torrent.size = items[i].enclosure[0].$.length;
    torrent.name = items[i].title[0];
    const link = items[i].link[0];
    torrent.link = link;
    torrent.id = link.substring(link.indexOf('?tid=') + 5);
    torrent.url = items[i].enclosure[0].$.url;
    torrent.hash = items[i].guid[0]._ || items[i].guid[0];
    torrents.push(torrent);
  }
  return torrents;
};

const _getTorrentsHappyFappy = async function (rssUrl) {
  const rss = await parseXml(await _getRssContent(rssUrl));
  const torrents = [];
  const items = rss.rss.channel[0].item;
  for (let i = 0; i < items.length; ++i) {
    const torrent = {
      size: 0,
      name: '',
      hash: '',
      id: 0,
      url: '',
      link: ''
    };
    torrent.size = items[i].torrent[0].contentLength[0];
    torrent.name = items[i].title[0];
    const link = items[i].link[0];
    torrent.link = link;
    torrent.id = link.substring(link.indexOf('?id=') + 4);
    torrent.url = items[i].enclosure[0].$.url;
    torrent.hash = items[i].torrent[0].infoHash[0];
    torrent.hash = Buffer.from(unescape(torrent.hash), 'binary').toString('hex');
    torrents.push(torrent);
  }
  return torrents;
};

const _getTorrentsWrapper = {
  'filelist.io': _getTorrentsFileList,
  'blutopia.xyz': _getTorrentsUnit3D2,
  'jptv.club': _getTorrentsUnit3D,
  'monikadesign.uk': _getTorrentsUnit3D2,
  'torrentdb.net': _getTorrentsTorrentDB,
  'uhdbits.org': _getTorrentsUHDBits,
  'www.empornium.is': _getTorrentsEmpornium,
  'www.skyey2.com': _getTorrentsSkyeySnow,
  'hdbits.org': _getTorrentsHDBits,
  'beyond-hd.me': _getTorrentsBeyondHD,
  'pt.sjtu.edu.cn': _getTorrentsPuTao,
  'hd-torrents.org': _getTorrentsHDTorrents,
  'hdcity.leniter.org': _getTorrentsHDCity,
  'iptorrents.com': _getTorrentsIPTorrents,
  'mikanani.me': _getTorrentsMikanProject,
  'learnflakes.net': _getTorrentsLearnFlakes,
  'exoticaz.to': _getTorrentsExoticaZ,
  'avistaz.to': _getTorrentsExoticaZ,
  'cinemaz.to': _getTorrentsExoticaZ,
  'privatehd.to': _getTorrentsExoticaZ,
  'rss.torrentleech.org': _getTorrentsTorrentLeech,
  'nextpt.net': _getTorrentsFSM,
  'www.happyfappy.org': _getTorrentsHappyFappy
};

exports.getTorrents = async function (rssUrl) {
  const host = new URL(rssUrl).host;
  try {
    if (_getTorrentsWrapper[host]) {
      return await _getTorrentsWrapper[host](rssUrl);
    }
    return await _getTorrents(rssUrl);
  } catch (e) {
    logger.error(host, '获取 Rss 报错', e);
    return [];
  }
};

exports.getTorrentName = async function (url) {
  const res = await util.requestPromise({
    url: url,
    method: 'HEAD'
  });
  const dis = res.headers['content-disposition'];
  const filename = dis.substring(dis.indexOf('filename=') + 9);
  return decodeURIComponent(filename);
};

exports.getTorrentNameByBencode = async function (url) {
  const res = await util.requestPromise({
    url: url,
    method: 'GET',
    encoding: null
  });
  const buffer = Buffer.from(res.body, 'utf-8');
  const torrent = bencode.decode(buffer);
  const size = torrent.info.length || torrent.info.files.map(i => i.length).reduce(_getSum, 0);
  const fsHash = crypto.createHash('sha1');
  fsHash.update(bencode.encode(torrent.info));
  const md5 = fsHash.digest('md5');
  let hash = '';
  for (const v of md5) {
    hash += v < 16 ? '0' + v.toString(16) : v.toString(16);
  }
  const filepath = path.join(__dirname, '../../torrents', hash + '.torrent');
  fs.writeFileSync(filepath, buffer);
  return {
    hash,
    size,
    name: torrent.info.name.toString()
  };
};
