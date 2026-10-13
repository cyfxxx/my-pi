# 网页资源索引

> **来源**：Chrome 书签导出（2026-10-11），经隐私过滤整理。
> **用途**：平时检索信息时的辅助与索引 —— 先在这里按分类或关键词定位，再去访问。
>
> ⚠️ **很多条需要外部网络才能访问**（并非失效）。若某条打不开，先确认网络环境，不要据此断定网站已关停。
>
> 机器可读版本：[`web-index.json`](web-index.json)（同目录，含 category/sub/title/url 四字段）。

## 怎么用

```bash
# 按关键词找（标题 / 分类 / URL 都能命中）
grep -i '关键词' docs/reference/WEB-INDEX.md

# 只要 URL
grep -oE 'https?://[^ )>]+' docs/reference/WEB-INDEX.md | sort -u

# 按分类看机器可读清单
jq -r '.entries[] | select(.category=="安全与取证") | "\(.title)\t\(.url)"' docs/reference/web-index.json
```

## 统计

| 分类 | 条数 |
|---|---|
| 学习与研究 | 180 |
| AI 与模型 | 27 |
| 开发与工具 | 6 |
| 网络与服务器 | 48 |
| 安全与取证 | 66 |
| 软件与系统 | 50 |
| 实用工具 | 54 |
| 素材与音频 | 76 |
| 影音与娱乐 | 183 |
| **合计** | **690** |

> 原始书签 907 条，剔除 217 条：个人账号/邮箱/网盘、内网与本机地址、个人信息标识、个人事务、接码与临时身份、成人内容、破解与账号交易、免费翻墙代理目录、浏览器内部页、URL 跟踪参数。

---

## 学习与研究（180）

| 子类 | 标题 | 网址 |
|---|---|---|
| 书籍 | Calibre-Web \| 书籍 | <https://www.aming.work:8083/> |
| 书籍 | DigiLibraries.com - 免费电子书库 | <https://digilibraries.com/> |
| 书籍 | FreeMbook Search | <https://freembook.com/> |
| 书籍 | Library Genesis | <https://libgen.li/index.php> |
| 书籍 | LoreFree-去中心化免费电子书共享社区 | <https://ebook2.lorefree.com/#> |
| 书籍 | https://bk.hallowlib.org | <https://bk.hallowlib.org/> |
| 书籍 | 书享家 | <http://shuxiangjia.cn/> |
| 书籍 | 云海免费电子图书馆 | <http://www.pdfbook.cn/> |
| 书籍 | 免费在线书籍 | <https://www.justfreebooks.info/> |
| 书籍 | 图书馆创世纪 | <http://libgen.rs/> |
| 书籍 | 安娜的档案 | <https://annas-archive.org/> |
| 书籍 | 安娜的档案 | <https://ja.annas-archive.org/> |
| 书籍 | 未来书籍搜索-免费电子书搜索引擎 | <https://bks.thefuture.top/> |
| 书籍 | 熊猫搜书 | <https://xmsoushu.com/#/> |
| 书籍 | 电子书搜索 | <https://www.giffox.com/> |
| 书籍 | 第一图书网_PDF图书下载_PDF教材下载_免费PDF电子书下载 | <http://www.tushu007.com/> |
| 书籍 | 绝版资料库 绝版PDF求助 | <https://mtoou.info/jueban/qiuzhu/so/> |
| 书籍 | 联图云.光盘 | <http://discx.yuntu.io/> |
| 书籍 | 联机图书页面 | <http://onlinebooks.library.upenn.edu/> |
| 书籍 | 苦瓜书盘 | <https://kgbook.com/> |
| 书籍 | 读书派 | <https://www.dushupai.com/> |
| 书籍 | 首页 - PDF下载之家 | <https://downloadpdf.cn/index.html> |
| 书籍 / Zlibrary | Z-Library Project | <https://z-lib.id/> |
| 书籍 / Zlibrary | Z-Library – the world’s largest e-book library. Your gateway to knowledge and culture. | <https://z-lib.fm/> |
| 书籍 / Zlibrary | Z-Library – 世界上最大的电子图书馆。自由访问知识和文化。 | <https://zh.kid1412.ink/> |
| 书籍 / Zlibrary | Z-library Project - eBook Library Z. Download free Books | <https://z-library.sk/> |
| 书籍 / 古籍 | 中医书籍_中医世家 | <http://www.zysj.com.cn/lilunshuji/index.html> |
| 书籍 / 古籍 | 书库 经部 | <https://cnkgraph.com/Book> |
| 书籍 / 古籍 | 古籍善本_中国古籍网_古籍电子书 | <http://book.shufaji.com/> |
| 书籍 / 古籍 | 古籍館-中國最大的古籍圖書館 | <https://gujiguan.com/> |
| 书籍 / 古籍 | 漢典古籍 | <https://gj.zdic.net/> |
| 交流 | 4chan | <https://www.4chan.org/> |
| 交流 | Discord | <https://discord.com/guild-discovery> |
| 交流 | Discord服务器列表 | <https://disboard.org/zh-cn> |
| 交流 | Facebook | <https://www.facebook.com/> |
| 交流 | Instagram | <https://www.instagram.com/> |
| 交流 | Quora | <https://www.quora.com/> |
| 交流 | Stack Overflow | <https://stackoverflow.com/> |
| 交流 | Telegram | <https://web.telegram.org/#/im> |
| 交流 | Telegram TGStat | <https://cn.tgstat.com/> |
| 交流 | Telegram 台湾群组索引 | <https://www.telegram.url.tw/> |
| 交流 | Telegram频道- TG 公众索引系统 | <https://tgtw.cc/index.php?type=1> |
| 交流 | Twitter | <https://mobile.twitter.com/home> |
| 交流 | V2EX | <https://www.v2ex.com/> |
| 交流 | reddit | <https://www.reddit.com/> |
| 交流 | telegram中文搜索 | <http://www.sssoou.com/> |
| 交流 | 台湾论坛 | <https://www.ptt.cc/bbs/index.html> |
| 信息 | Google 趋势 | <https://trends.google.com/trends/> |
| 信息 | Google快讯 | <https://www.google.com.ph/alerts?hl=zh-CN&tab=33> |
| 信息 | 中国数字时代 | <https://chinadigitaltimes.net/chinese/> |
| 信息 | 今日热榜官网 | <https://tophub.today/> |
| 信息 | 兽野 | <https://kemono.party/> |
| 信息 | 掘金谷 | <https://www.juejingu.com/> |
| 信息 | 鱼塘热榜 | <https://mo.fish/?class_id=%E5%85%A8%E9%83%A8&hot_id=1065> |
| 学习 | DeepWiki | <https://deepwiki.org/> |
| 学习 | Github趋势报告 | <https://www.githubs.cn/trending> |
| 学习 | How To Cook  （做菜） | <https://cook.aiurs.co/> |
| 学习 | IT 人必备工具箱 | <https://666666.dev/> |
| 学习 | wikiHow （生活指导手册） | <https://zh.wikihow.com/%E9%A6%96%E9%A1%B5#> |
| 学习 | 浙江大学课程攻略共享计划 | <https://qsctech.github.io/zju-icicles/> |
| 学术 | AMiner - 探索科学与技术的动力 | <https://www.aminer.cn/> |
| 学术 | ERIC - 教育资源信息中心 | <https://eric.ed.gov/> |
| 学术 | Litmaps 论文学习 | <https://www.litmaps.com/> |
| 学术 | NSTL国家科技图书文献中心 | <https://www.nstl.gov.cn/> |
| 学术 | 中国知网 | <https://www.cnki.net/?UID=WEEvREcwSlJHSldTTEYzVDhUQ05ZSi92MG54dkw2MXN1UXArcjdCUU9Xaz0%3d%249A4hF_YAuvQ5obgVAqNKPCYcEjKensW4IQMovwHtwkF4VYPoHbKxJw!!&PlatForm=kns> |
| 学术 | 中国科学院知识服务平台 | <https://www.las.ac.cn/> |
| 学术 | 小木虫 | <http://muchong.com/> |
| 学术 | 汉斯期刊 开放获取 | <https://www.hanspub.org/?btwaf=50626741> |
| 学术 | 科学知识平台 | <https://www.x-mol.com/> |
| 学术 / 图书馆 | 中国国家图书馆· | <http://www.nlc.cn/web/select.html> |
| 学术 / 图书馆 | 佛山市图书馆 | <https://www.fslib.com.cn/> |
| 学术 / 图书馆 | 全国图书馆参考咨询联盟 | <http://www.ucdrs.superlib.net/> |
| 学术 / 图书馆 | 广州图书馆·首页 | <http://www.gzlib.org.cn/> |
| 学术 / 图书馆 | 开放存取图书馆（OALib） | <http://www.oalib.com/> |
| 学术 / 图书馆 | 浙江图书馆 | <https://www.zjlib.cn/> |
| 学术 / 图书馆 | 绍兴图书馆-绍兴数字图书馆 | <https://www.sxlib.com/> |
| 学术 / 图书馆 | 美国数字公共图书馆 | <https://dp.la/> |
| 学术 / 图书馆 | 贵州数字图书馆 | <http://www.gzlib.org/> |
| 学术 / 学术搜索 | Google 学术搜索 | <https://scholar.google.com.hk/?hl=zh-CN> |
| 学术 / 学术搜索 | SCI-HUB.Pub | <https://www.sci-hub.pub/> |
| 学术 / 学术搜索 | gfsoso 学术搜索 | <https://c3.glgoo.top/scholar/> |
| 学术 / 学术搜索 | iData-知识检索 | <https://www.cn-ki.net/> |
| 学术 / 学术搜索 | 学术搜索 | <https://scholar.chongbuluo.com/> |
| 学术 / 学术搜索 | 学术搜索引擎 | <http://www.xuan.cool/academic.html> |
| 学术 / 学术搜索 | 小鲸鱼文献 | <http://www.9312.net/#/> |
| 学术 / 学术搜索 | 库问搜索 | <http://www.koovin.com/> |
| 学术 / 学术搜索 | 文献部落 | <http://459.org/> |
| 学术 / 学术搜索 | 淘链客 | <https://www.taolinks.cc/s/> |
| 学术 / 学术搜索 | 百度学术 | <https://xueshu.baidu.com/> |
| 学术 / 学术搜索 | 科普中心 | <https://www.sci-hub.ren/> |
| 技术论坛 | CSDN-专业IT技术社区 | <https://www.csdn.net/> |
| 技术论坛 | 归档 -教程 | <https://www.techxiaofei.com/post/> |
| 技术论坛 | 果冻的猿宇宙 – Just Do IT，放胆做挨踢 | <https://www.xiaogd.net/> |
| 数据 | Windy （气象信息） | <https://www.windy.com/> |
| 数据 | 《中国大百科全书》第三版网络版 | <https://www.zgbk.com/> |
| 数据 | 中国大百科全书数据库 | <https://h.bkzx.cn/> |
| 数据 | 中国近代影像资料库 | <https://www.lzp360.com/> |
| 数据 | 医学百科全书 | <http://www.a-hospital.com/w/%E9%A6%96%E9%A1%B5> |
| 数据 | 国家数据 | <http://data.stats.gov.cn/easyquery.htm?cn=C01> |
| 数据 | 媒体维基 | <https://www.mediawiki.org/wiki/MediaWiki> |
| 数据 | 我们的数据世界 | <https://ourworldindata.org/> |
| 数据 | 指数 | <http://www.xuan.cool/data.html> |
| 数据 | 果汁排行榜 | <http://guozhivip.com/rank/index.html> |
| 数据 | 维基教科书 | <https://en.wikibooks.org/wiki/Main_Page> |
| 数据 | 维基文库，自由的图书馆 | <https://zh.wikisource.org/wiki/Wikisource:%E9%A6%96%E9%A1%B5> |
| 数据 | 默沙东诊疗手册 | <https://www.msdmanuals.cn/?ruleredirectid=14#mission> |
| 电路仿真 | Circuitjs web 在线电路模拟器 | <https://cc.xiaogd.net/> |
| 电路仿真 | Filter - 仿真 | <https://phet.colorado.edu/zh_CN/simulations/filter?type=html,prototype> |
| 电路仿真 | circuitjs电路仿真 | <https://www.falstad.com/circuit/circuitjs.html> |
| 电路仿真 | 嘉立创EDA(专业版) | <https://pro.lceda.cn/editor> |
| 电路仿真 | 电工基础知识 | <https://www.dgxue.com/> |
| 综合 | Anime-Sharing Community | <https://www.anime-sharing.com/forum/> |
| 综合 | EverythingMoe | <https://everythingmoe.com/> |
| 综合 | F95区 | <https://f95zone.to/> |
| 综合 | Home • Wotaku.wiki by Duck | <https://wotaku.wiki/> |
| 综合 | 东半夏洛的小博客 | <https://dl666123.github.io/> |
| 编程 | GitHub 入门级开源项目 | <https://hellogithub.com/> |
| 编程 | build-your-own-x | <https://github.com/codecrafters-io/build-your-own-x#build-your-own-programming-language> |
| 编程 | 在线打字测试（dazi.kukuw.com） | <https://dazi.kukuw.com/my_typing.php?do=index> |
| 编程 | 基于项目的教程的精选列表 | <https://github.com/practical-tutorials/project-based-learning> |
| 编程 | 开发者搜索-beta | <https://kaifa.baidu.com/home> |
| 编程 | 菜鸟教程 | <https://www.runoob.com/> |
| 编程 / 在线文档 | Apache Web Server文档 | <http://httpd.apache.org/docs/> |
| 编程 / 在线文档 | Docker官方文档 | <https://docs.docker.com/get-started/> |
| 编程 / 在线文档 | Dubbo中文文档 | <https://dubbo.apache.org/zh/docs/> |
| 编程 / 在线文档 | Elasticsearch官方文档 | <https://www.elastic.co/guide/en/elasticsearch/reference/current/index.html> |
| 编程 / 在线文档 | Git中文教程 | <https://git-scm.com/book/zh/v2> |
| 编程 / 在线文档 | Golang标准库文档中文版 | <https://studygolang.com/pkgdoc> |
| 编程 / 在线文档 | Java 8官方文档 | <https://docs.oracle.com/javase/8/docs/api/index.html> |
| 编程 / 在线文档 | Jenkins中文文档 | <https://www.jenkins.io/zh/doc/> |
| 编程 / 在线文档 | Kafka中文文档 | <https://kafka.apachecn.org/> |
| 编程 / 在线文档 | Maven官方文档 | <http://maven.apache.org/guides/> |
| 编程 / 在线文档 | Mybatis中文文档 | <https://mybatis.org/mybatis-3/zh/index.html> |
| 编程 / 在线文档 | Netty官方文档 | <https://netty.io/wiki/index.html> |
| 编程 / 在线文档 | Nginx中文文档 | <https://www.nginx.cn/doc/index.html> |
| 编程 / 在线文档 | Nodejs中文教程文档 | <http://nodejs.cn/learn/> |
| 编程 / 在线文档 | RabbitMQ官方文档 | <https://www.rabbitmq.com/documentation.html> |
| 编程 / 在线文档 | React.js官方文档 | <https://reactjs.org/docs/getting-started.html> |
| 编程 / 在线文档 | RocketMQ官方文档 | <http://rocketmq.apache.org/docs/quick-start/> |
| 编程 / 在线文档 | SVN中文手册 | <http://svnbook.red-bean.com/nightly/zh/index.html> |
| 编程 / 在线文档 | Spring Boot官方文档 | <https://docs.spring.io/spring-boot/docs/current/reference/htmlsingle/> |
| 编程 / 在线文档 | Spring Cloud官方文档 | <https://spring.io/projects/spring-cloud> |
| 编程 / 在线文档 | Spring文档中文版 | <https://www.springcloud.cc/spring-reference.html> |
| 编程 / 在线文档 | Tomcat 8官方文档 | <http://tomcat.apache.org/tomcat-8.0-doc/index.html> |
| 编程 / 在线文档 | Vue.js中文文档 | <https://cn.vuejs.org/v2/guide/> |
| 编程 / 在线文档 | jQuery API中文文档 | <https://jquery.cuishifeng.cn/> |
| 编程 / 在线文档 | kubernetes中文文档 | <https://kubernetes.io/zh/docs/home/> |
| 编程 / 在线文档 | thymeleaf官方文档 | <https://www.thymeleaf.org/documentation.html> |
| 编程 / 在线文档 | 微信小程序官方文档 | <https://developers.weixin.qq.com/miniprogram/dev/framework/> |
| 编程 / 镜像源 | 中科大镜像源 | <https://mirrors.ustc.edu.cn/> |
| 编程 / 镜像源 | 清华大学开源软件镜像站 | <https://mirrors.tuna.tsinghua.edu.cn/> |
| 编程 / 镜像源 | 阿里巴巴开源镜像站 | <https://developer.aliyun.com/mirror/?serviceType=mirror> |
| 网站导航 | NEET姬の私人小窝 | <https://www.acy.moe/> |
| 网站导航 | Shortcuts Gallery - 少数派 | <https://shortcuts.sspai.com/#/main/workflow> |
| 网站导航 | V2方圆 – 发掘稀缺资源 v2fy zhaoolee | <https://www.v2fy.com/> |
| 网站导航 | iMyShare - 收集免费实用有趣的东西，做最好的资源导航 | <https://imyshare.com/navigation/> |
| 网站导航 | 书签地球 | <https://www.bookmarkearth.com/> |
| 网站导航 | 合集网 \| 信息资源大全 | <https://233heji.com/> |
| 网站导航 | 呲哩呲哩 （二次元） | <http://www.cilicili.cc/> |
| 网站导航 | 爱达导航 | <https://adzhp.cn/> |
| 网站导航 | 网站资源合集 | <https://nyxz166.cn/Web.php#id-4> |
| 网站导航 | 网站资源合集 | <https://nyxz166.cn/Web.php#id-7> |
| 网站导航 | 聚BT - 聚合最优质的BT、磁力资源 | <https://jubt12.xyz/cn/index.html> |
| 网站导航 | 萌姬导航 | <https://www.accy.top/> |
| 网站导航 | 音速装机 - 群狼动力 | <https://sonic.volf.club/> |
| 网站导航 | 龙轩导航-做个有用的导航 | <http://m.ilxdh.com/> |
| 资源 | Browse :: Nyaa | <https://nyaa.si/> |
| 资源 | Browse :: Sukebei | <https://sukebei.nyaa.si/> |
| 资源 | CC 搜索门户 | <https://search.creativecommons.org/> |
| 资源 | Wiby.org-现代网络搜索门户 | <https://wiby.org/> |
| 资源 | 互联网档案 | <https://archive.org/> |
| 资源 | 点点文档搜索 | <https://www.torrent.org.cn/bd> |
| 资源 | 虚拟手稿图书馆 | <http://www.e-codices.unifr.ch/en> |
| 资源 | 鸠摩搜索 - 文档搜索引擎 | <https://www.jiumodiary.com/> |
| 资源 / 网盘 | 云盘狗 | <http://yunpangou.com/> |
| 资源 / 网盘 | 在 Google 云端硬盘中查找公共文件 | <https://www.dedigger.com/#gsc.tab=0> |
| 资源 / 网盘 | 小马盘 - 网盘搜索引擎 | <https://www.xiaomapan.com/#/main/search?restype=1> |
| 资源 / 网盘 | 我的小站-阿里云盘资源共享站 | <https://pan666.net/> |
| 资源 / 网盘 | 网盘搜索，就用大力盘搜索 | <https://www.dalipan.com/> |
| 资源 / 网盘 | 网盘搜索，就用大圣盘 | <https://www.dashengpan.com/> |

## AI 与模型（27）

| 子类 | 标题 | 网址 |
|---|---|---|
| 图像 | CivArchive (CivitAI Archive) | <https://civarchive.com/> |
| 图像 | Civitai | <https://civitai.com/> |
| 图像 | NovelAI | <https://www.yuque.com/longyuye/lmgcwy> |
| 图像 | 藏丹阁-NovelAI模型大全分享-第一层开放 | <https://docs.qq.com/doc/DY0lFeWZuVXRCdUJU> |
| 模型下载 | HF-Mirror | <https://hf-mirror.com/> |
| 模型下载 | Hugging Face | <https://huggingface.co/> |
| 模型下载 | 模型库· 魔搭社区 | <https://www.modelscope.cn/models> |
| 网页使用 | Bard | <https://bard.google.com/chat> |
| 网页使用 | ChatGPT | <https://chat.openai.com/#pricing> |
| 网页使用 | DeepSeek | <https://www.deepseek.com/> |
| 网页使用 | Kimi.ai | <https://kimi.moonshot.cn/> |
| 网页使用 | Qwen | <https://chat.qwen.ai/> |
| 网页使用 | 克洛德 | <https://claude.ai/chats> |
| 网页使用 | 豆包 | <https://www.doubao.com/chat/> |
| 网页使用 | 通义千问 | <https://www.qianwen.com/> |
| 语音 | AI Hobbyist 交流社区 | <https://www.ai-hobbyist.org/> |
| 语音 | AI二创资源中心 | <https://ai.ai-hobbyist.org/> |
| 语音 | RVC AI模型社区 | <https://ai.bianshengruanjian.com/> |
| 语音 | So-VITS-SVC 4.1 整合包完全指南 | <https://www.yuque.com/umoubuton/ueupp5> |
| 语音 | so-vits-svc-4.0模型 | <https://huggingface.co/therealvul/so-vits-svc-4.0/tree/main> |
| 语音 | 首页 | <http://www.timbremodel.com/#/index> |
| 酒馆 | AI 角色卡 | <https://aicharactercards.com/> |
| 酒馆 | Character Tavern | <https://character-tavern.com/> |
| 酒馆 | SillyTavern 入门指北 | <https://linux.do/t/topic/223253> |
| 酒馆 | SillyTavern（酒馆）从入门到精通 | <https://www.rainlain.com/index.php/2024/11/19/2645/> |
| 酒馆 | janitorai | <https://janitorai.com/> |
| 酒馆 | ny预设 gemini特辑 | <https://rentry.org/ny-jailbreak-gemini> |

## 开发与工具（6）

| 子类 | 标题 | 网址 |
|---|---|---|
|  | https://www.cnblogs.com/twinblade-i/p/18797195 | <https://www.cnblogs.com/twinblade-i/p/18797195> |
|  | AI工具集 | <https://ai-bot.cn/> |
|  | LFS Linux | <https://www.linuxfromscratch.org/lfs/> |
|  | PairDrop | <https://pairdrop.net/> |
|  | RustDesk | <http://web.rustdesk.com/#/> |
|  | 密的文件共享 | <https://wormhole.app/> |

## 网络与服务器（48）

| 子类 | 标题 | 网址 |
|---|---|---|
| 测速 | Ookla的Speedtest-全球宽带速度测试 | <https://www.speedtest.net/result/9275746231> |
| 测速 | 中国科学技术大学测速网站 | <https://test.ustc.edu.cn/> |
| 测速 | 测速网 - 在线网速测试,网络测速,网站观测,路由测试,Ping测试,5G测速 - SpeedTest.cn | <https://www.speedtest.cn/> |
| 网站 | Hexo | <https://hexo.io/zh-cn/index.html> |
| 网站 | 免费动态 DNS | <https://www.noip.com/> |
| 网站 | 站长工具 - 站长之家 | <https://tool.chinaz.com/> |
| 网站 / 域名 | Domain List for MCM43-FREE | <https://nic.eu.org/arf/en/> |
| 网站 / 域名 | 发射台 - Spaceship | <https://www.spaceship.com/zh/launchpad/> |
| 网站 / 域名 | 哪煮米 - 全网域名,一站比价 | <https://www.nazhumi.com/> |
| 网站 / 域名 | 域名注册优惠_-华为云 | <https://activity.huaweicloud.com/domain1.html?bd_vid=12312315054806570380> |
| 网站 / 域名 | 域名特惠活动_腾讯云 | <https://cloud.tencent.com/act/pro/domain-sales> |
| 网站 / 域名 | 找到您的免费​​域名 | <https://www.dynadot.com/register-your-free-link-domain> |
| 网站 / 域名 | 西部数码 | <https://www.west.cn/m/active/one/> |
| 网站 / 建站 | Halo 建站 | <https://halo.run/> |
| 网站 / 建站 | Hashnode | <https://hashnode.com/> |
| 网站 / 建站 | Nextra | <https://nextra.site/> |
| 网站 / 建站 | Wix.com | <https://manage.wix.com/dashboard/4a3e6137-c269-4e23-8215-a9504527e538/home?referralInfo=sidebar> |
| 网站 / 建站 | WordPress.org | <https://cn.wordpress.org/> |
| 网站 / 建站 | weebly | <https://www.weebly.com/websites> |
| 网站 / 托管 | Cloudflare | <https://dash.cloudflare.com/2390a8da9d2186b6ad44b65b0151fb9f/workers-and-pages> |
| 网站 / 托管 | Dashboard – Vercel | <https://vercel.com/dashboard> |
| 网站 / 托管 | Render Dashboard | <https://dashboard.render.com/login?next=%2Fblueprint%2Fnew%3Frepo%3Dhttps%3A%2F%2Fgithub.com%2Fadams549659584%2Fgo-proxy-bingai> |
| 网站 / 托管 | WordPress.com | <https://zh-cn.wordpress.com/> |
| 网站 / 托管 | probable-crib \| Railway | <https://railway.app/project/b71554ae-e67d-4e89-aaef-92ab80ed1a1a> |
| 网站 / 服务器 | 1Panel | <https://1panel.cn/> |
| 网站 / 服务器 / VPS | BandwagonHost VPS | <https://bwh81.net/> |
| 网站 / 服务器 / VPS | CloudCone | <https://cloudcone.com/> |
| 网站 / 服务器 / VPS | Hostwinds | <https://www.hostwinds.com/> |
| 网站 / 服务器 / VPS | RackNerd | <https://www.racknerd.com/> |
| 网站 / 服务器 / VPS | Vultr.com | <https://www.vultr.com/> |
| 网站 / 服务器 / 云服务器 | AWS | <https://us-east-1.console.aws.amazon.com/console/home?region=us-east-1> |
| 网站 / 服务器 / 云服务器 | UCloud中立云计算服务商 | <https://www.ucloud.cn/active/ulhost.html?invitation_code=C1xD0774E4BC648> |
| 网站 / 服务器 / 云服务器 | 云小站 - 硅云 | <https://www.vpsor.cn/activity/cloudsite?userCode=wh2033f> |
| 网站 / 服务器 / 云服务器 | 华为云 | <https://activity.huaweicloud.com/newyear_promotion/index.html?bd_vid=11285202775566348889> |
| 网站 / 服务器 / 云服务器 | 百度云 | <https://cloud.baidu.com/product/bcc.html#%E4%BA%A7%E5%93%81%E9%80%89%E5%9E%8B> |
| 网站 / 服务器 / 云服务器 | 腾讯云 | <https://cloud.tencent.com/> |
| 网站 / 服务器 / 云服务器 | 阿里云 | <https://www.aliyun.com/> |
| 网络 | Cloudflare | <https://dash.cloudflare.com/2390a8da9d2186b6ad44b65b0151fb9f> |
| 网络 | ZeroTier Central（内网穿透） | <https://my.zerotier.com/network> |
| 网络 | 提高您的在线隐私安全 \| BrowserScan | <https://www.browserscan.net/> |
| 网络 | 查找 Cloudflare 的干净 IP | <https://vfarid.github.io/cf-ip-scanner/?max=30> |
| 网络工具 | ICANN 查询 --- ICANN Lookup | <https://lookup.icann.org/zh> |
| 网络工具 | IP address data | <https://ipinfo.io/> |
| 网络工具 | IPv6 测试 | <http://testipv6.cn/mirrors.html.zh_CN> |
| 网络工具 | IPv6 测试（翻） | <http://www.test-ipv6.com/> |
| 网络工具 | IP地址归属地查询 | <https://www.ip138.com/> |
| 网络工具 | IP地址查询 | <https://www.ipip.net/ip.html> |
| 网络工具 | 网络 BGP 工具包 | <https://bgp.he.net/> |

## 安全与取证（66）

| 子类 | 标题 | 网址 |
|---|---|---|
| 去中心 | IPFS 为分布式网络提供动力 | <https://ipfs.tech/> |
| 去中心 | Sia - Get Started | <https://sia.tech/get-started> |
| 去中心 | 自由未来的去中心化互联网 \| 天网 | <https://web3portal.com/> |
| 去中心 / Sync | Resilio Sync Keys - NOVA | <https://nova.wodemo.net/keys> |
| 去中心 / Sync | Resilio Sync License 授权文件下载 | <https://iui.su/956/> |
| 去中心 / Sync | 🍊 新奇士 - Resilio Sync Keys 中文索引 | <https://www.synckeys.com/> |
| 去中心 / 磁力 | GloDLS.to | <https://glodls.to/home.php> |
| 去中心 / 磁力 | btav | <https://m.838888.net/cb.php> |
| 去中心 / 磁力 | 洪流搜索引擎\| 1337x.to | <https://1337x.to/> |
| 安全 | 下载追踪 | <https://iknowwhatyoudownload.com/en/link/> |
| 安全 | 你是匿名者吗？ | <https://www.nothingprivate.ml/> |
| 安全 | 图片混淆 | <https://fyhb.gitee.io/tphx/> |
| 安全 | 密码泄漏查询 \| HaveIBeenPwned | <https://haveibeenpwned.com/> |
| 安全 | 查看您的个人信息是否已被泄露 | <https://monitor.firefox.com/> |
| 安全 | 检查您的电子邮件或用户名是否被泄露 | <https://breachdirectory.org/#> |
| 安全 | 病毒吧进吧导航 | <https://docs.qq.com/doc/DTHZzdVlRVnFsZnNT> |
| 文件查毒 | MetaDefender云\| 主页 | <https://metadefender.opswat.com/?lang=en> |
| 文件查毒 | VirSCAN.org - Free Multi-Engine Online Virus Scanner v1.02, Supports 47 AntiVirus Engines! | <https://www.virscan.org/> |
| 文件查毒 | VirSCAN.org-多引擎在线病毒扫描网 v1.02，当前支持 47 款杀毒引擎 | <https://www.virscan.org/language/zh-cn/> |
| 文件查毒 | VirusTotal | <https://www.virustotal.com/gui/> |
| 文件查毒 | WEBDIR+ - WebShell 扫描服务 - OpenRASP 团队 | <https://scanner.baidu.com/#/pages/intro> |
| 文件查毒 | 关于Jotti的恶意软件扫描系统 | <https://virusscan.jotti.org/> |
| 文件查毒 | 卡巴斯基威胁情报门户–病毒扫描程序/检查程序 | <https://opentip.kaspersky.com/> |
| 文件查毒 | 恶意软件分析 & URL链接扫描 免费在线病毒分析平台 \| 魔盾安全分析 | <https://maldun.com/dashboard/> |
| 文件查毒 | 腾讯哈勃分析系统 | <https://habo.qq.com/> |
| 病毒防护 | 360系统急救箱 | <https://weishi.360.cn/jijiuxiang/> |
| 病毒防护 | 卡巴斯基 免费版 | <https://www.kaspersky.com.cn/free-antivirus> |
| 病毒防护 | 卡巴斯基和ESET版本选购指南 | <https://tieba.baidu.com/p/9276773418> |
| 病毒防护 | 卡巴斯基试用版下载 | <https://www.kaspersky.com.cn/downloads> |
| 病毒防护 | 火绒安全 | <https://www.huorong.cn/> |
| 病毒防护 | 火绒恶性木马专杀工具 | <https://bbs.huorong.cn/thread-18575-1-1.html> |
| 病毒防护 | 病毒清除工具-卡巴斯基 | <https://www.kaspersky.com.cn/downloads/free-virus-removal-tool> |
| 网络代理 | BridgeDB(网桥，翻） | <https://bridges.torproject.org/options> |
| 网络代理 | openclash转换订阅网址 | <https://sub-web.netlify.app/> |
| 网络代理 | v2ray free | <https://github.com/search?q=v2ray+free&type=repositories&s=stars&o=desc> |
| 网络代理 | 订阅地址 | <https://fofa.info/result?qbase64=Ym9keT0i6Ieq5Yqo5oqT5Y%20WdGfpopHpgZPjgIHorqLpmIXlnLDlnYDjgIHlhazlvIDkupLogZTnvZHkuIrnmoRzc%20OAgXNzcuOAgXZtZXNz44CBdHJvamFu6IqC54K55L%20h5oGvIg%3D%3D> |
| 网络代理 / 教程 | ACL4SSR_在线订阅转换 | <https://acl4ssr.netlify.app/> |
| 网络代理 / 教程 | Cloudflare CDN反代免费VPN高速上网，速度超快，千兆节点、解锁奈飞流媒体 - 科技小飞哥 | <https://www.techxiaofei.com/post/vpn/cdn/> |
| 网络代理 / 教程 | DuyaoSS-机场测速和简介 | <https://www.duyaoss.com/> |
| 网络代理 / 教程 | Home - riseup.net | <https://riseup.net/en> |
| 网络代理 / 教程 | VPN – 免费资源网路社群 | <https://free.com.tw/tag/vpn/> |
| 网络代理 / 教程 | 墻知乎 - 最全的翻墙知识聚集地 | <https://wallzhihu.com/amp/> |
| 网络代理 / 教程 | 如何用 Tor 访问对 Tor 不友好的网站——扫盲“三重代理”及其它招数 @ 编程随想的博客 | <https://program-think.blogspot.com/2020/08/Tor-Triple-Proxy.html> |
| 网络代理 / 教程 | 我们如何测试VPN-VPN报告 | <https://www.vpnreports.com/how-we-test-vpn/> |
| 网络代理 / 教程 | 机场推荐与机场评测 | <https://jichangtuijian.com/> |
| 网络代理 / 教程 | 聪聪 Blog | <https://congcong0806.github.io/2018/04/20/SS/> |
| 网络代理 / 机场 | GLaDOS | <https://glados.rocks/console> |
| 网络代理 / 机场 | Tickcloud | <https://www.tickcloud.net/> |
| 网络代理 / 机场 | XYZ | <https://9.234456.xyz/abc.html> |
| 网络代理 / 机场 | XYZ | <https://9.234456.xyz/abc.html> |
| 网络代理 / 机场 | 一分机场 | <https://xn--4gqx1hgtfdmt.com/#/register?code=3xKWB2Lq> |
| 网络代理 / 机场 | 穿云箭 | <https://chuanyunjian.uk/index.php#/register?code=0llVyrrq> |
| 网络代理 / 机场 | 购物车 - 棱角 | <https://www.lengjiao.me/cart.php> |
| 网络代理 / 网络代理 | 4everproxy - 免费网络代理\| 无限VPN | <https://www.4everproxy.com/> |
| 网络代理 / 网络代理 | KPROXY - 免费匿名网络代理 - 匿名代理 | <https://kproxy.com/> |
| 网络代理 / 网络代理 | ProxySite.com - 免费网络代理网站 | <https://www.proxysite.com/> |
| 网络代理 / 网络代理 | Web代理服务器列表 | <http://free-proxy.cz/zh/web-proxylist/> |
| 网络代理 / 网络代理 | www.ddung.orgGlype®代理 | <http://www.ddung.org/daili/> |
| 网络代理 / 网络代理 | 免费网络代理和最先进的在线代理\| 代理代理 | <https://www.croxyproxy.com/> |
| 网络代理 / 网络代理 | 最先进的安全且免费的网络代理 \| 代理代理 | <https://www.croxyproxy.rocks/> |
| 网络代理 / 软件 | 1.1.1.1 | <https://1.1.1.1/> |
| 网络代理 / 软件 | Cloudflare Zero Trust | <https://one.dash.cloudflare.com/2390a8da9d2186b6ad44b65b0151fb9f/home/quick-start> |
| 网络代理 / 软件 | SoftEther VPN 项目 - SoftEther VPN 项目 | <https://www.softether.org/> |
| 网络代理 / 软件 | Tor Project \| （暗网） | <https://www.torproject.org/zh-CN/> |
| 网络代理 / 软件 | VPN Gate 下载 | <https://www.vpngate.net/cn/download.aspx> |
| 网络代理 / 软件 | 蘑菇加速器官网 | <https://www.mogu23.com/> |

## 软件与系统（50）

| 子类 | 标题 | 网址 |
|---|---|---|
| 安卓软件 | 5play（优） | <https://5play.ru/en/android/apps/> |
| 安卓软件 | A2Z APK（可下付费，优） | <https://a2zapk.com/> |
| 安卓软件 | APKImage | <https://apkimage.io/?q=> |
| 安卓软件 | APKMirror | <https://www.apkmirror.com/> |
| 安卓软件 | APKPure官网（翻） | <https://apkpure.com/cn/> |
| 安卓软件 | Android App Mods - 获取最新的 Mod/付费更新 | <https://apkdone.com/app/> |
| 安卓软件 | Android 台湾中文网 | <https://apk.tw/forum.php> |
| 安卓软件 | ApkMos | <https://apkmos.com/> |
| 安卓软件 | Aptoide - 另类 Android 应用商店 | <https://en.aptoide.com/> |
| 安卓软件 | LITEAPKS - #1 MOD APK for Android | <https://liteapks.com/> |
| 安卓软件 | TechLoky | <https://techloky.com/> |
| 安卓软件 | Uptodown | <https://www.uptodown.com/> |
| 安卓软件 | ⚡ APKCombo | <https://apkcombo.com/zh/> |
| 安卓软件 | 在线APK下载器 | <https://apkcombo.com/zh-us/apk-downloader/> |
| 安卓软件 | 适用于 Android 的开源应用 APK - OpenAPK | <https://www.openapk.net/> |
| 工具箱 | LaodiTeachTips | <https://ldtstore.net/?fw=intl-root> |
| 工具箱 | U盘量产工具 | <https://www.upantool.com/> |
| 工具箱 | 一个工具箱 - 好用的在线工具都在这里！ | <http://www.atoolbox.net/> |
| 工具箱 | 图吧工具箱官方网站 | <https://www.tbtool.cn/index.html> |
| 系统 | FirPE Project – （PE系统） | <https://firpe.cn/> |
| 系统 | FirPE 维护系统 - FirPE Project | <https://firpe.cn/page-247> |
| 系统 | HelloWindows.cn - 精校 完整 极致 Windows系统下载仓储站 | <https://hellowindows.cn/> |
| 系统 | MSDN（系统下载） | <https://msdn.itellyou.cn/> |
| 系统 | NEXT, ITELLYOU | <https://next.itellyou.cn/> |
| 系统 | Ventoy（装机） | <https://www.ventoy.net/cn/doc_news.html> |
| 系统 | 下载 Windows 10（系统下载） | <https://www.microsoft.com/zh-cn/software-download/windows10> |
| 系统 | 下载 Windows 11 | <https://www.microsoft.com/zh-cn/software-download/windows11> |
| 软件 | Microsoft Store 下载 | <https://store.rg-adguard.net/> |
| 软件 | mefcl'blog | <https://www.mefcl.com/> |
| 软件 | 果核剥壳 | <https://www.ghpym.com/category/all> |
| 软件 | 驱动天空 - 专业、方便的驱动下载站 | <https://www.drvsky.com/index.htm> |
| 软件分享 | 423Down | <https://www.423down.com/> |
| 软件分享 | CrackingPatching | <https://crackingpatching.com/> |
| 软件分享 | FOSSHUB | <https://www.fosshub.com/> |
| 软件分享 | FTUApps.Dev | <https://ftuapps.dev/?1> |
| 软件分享 | FileCR | <https://filecr.com/en/?id=325048144000> |
| 软件分享 | Nsane 论坛 | <https://nsaneforums.com/leaderboard/> |
| 软件分享 | OSSSR.COM | <https://www.osssr.com/> |
| 软件分享 | Puresys纯净系统-软件下载 | <https://www.puresys.net/> |
| 软件分享 | 不死鸟 | <https://iui.su/win/> |
| 软件分享 | 六音 | <https://www.sixyin.com/> |
| 软件分享 | 六音软件 | <https://www.6yit.com/> |
| 软件分享 | 小众软件 | <https://www.appinn.com/> |
| 软件分享 | 悠久的小宝库 | <https://u9baoku.xyz/> |
| 软件分享 | 系统迷 | <https://www.xitmi.com/> |
| 软件分享 | 老殁 | <https://www.mpyit.com/?btwaf=58698073> |
| 软件分享 | 脑袋瓜子 | <https://www.naodai.org/> |
| 软件分享 | 脚本之家 | <https://www.jb51.net/> |
| 软件分享 | 雨糖科技 | <https://raincandy.tech/software-projects/> |
| 软件分享 | 预激活软件 | <https://getintoway.com/> |

## 实用工具（54）

| 子类 | 标题 | 网址 |
|---|---|---|
| PDF | PDF转Word \| 免费在线PDF转Word \| PDF转Word转换器 \| PDF转化速度快 \| 首页 | <https://www.alltoall.net/> |
| PDF | iLovePDF \| 为PDF爱好者提供的PDF文件在线处理工具 | <https://www.ilovepdf.com/zh-cn> |
| PDF | pdf在线处理套装1 | <https://tools.pdf24.org/zh/> |
| PDF | pdf在线处理套装2 | <https://smallpdf.com/cn/pdf-tools> |
| 图像 / 图床 | ImgBB — 免费图片存取/上传图片 | <https://imgbb.com/> |
| 图像 / 图床 | Imgur：互联网的魔力 | <https://imgur.com/upload> |
| 图像 / 图床 | MoeTu - 一个拥有全球 CDN 支持 HTTPS 的免费的图床 | <https://moetu.org/> |
| 图像 / 图床 | PNG8图床 - 全球最快的图床没有之一 | <https://www.png8.com/> |
| 图像 / 图床 | Z4A图床-做国内最良心的免费图床 - Z4A图床 | <https://www.z4a.net/> |
| 图像 / 图床 | 你好图床 | <http://tc.hellohao.cn/> |
| 图像 / 图床 | 图壳图床 | <https://imgkr.com/> |
| 图像 / 图床 | 图片上传 \| PicX 图床神器 | <https://picx.xpoet.cn/> |
| 图像 / 图床 | 牛图网 - 免费图片空间,图片上传,免费传图,免费上传图片,免费图片存储,免费外链,免费空间,PNG上传,GIF上传,JPEG上传,最好的图片上传站 | <https://niupic.com/> |
| 图像 / 图床 | 简单的免费图像托管 - SM.MS - 简单的免费图像托管 | <https://sm.ms/> |
| 图像 / 图床 | 聚合图床 - 免费无限图片上传, 一键分发, 多处备份 | <https://www.superbed.cn/> |
| 图像 / 图床 | 聚合图床 - 微博图床 - 免费图床 - 孟坤工具箱网页版 | <http://tool.mkblog.cn/tuchuang/> |
| 图像 / 图床 | 贴图库 — 免费、高速、稳定、专业图片外链 | <http://www.tietuku.com/> |
| 图像 / 图床 | 路过图床 - 免费图片上传, 专业图片外链, 免费公共图床 | <https://imgchr.com/> |
| 图像 / 图床 | 遇见图床 - 永久免费图床 专业图片上传 永久外链 全球CDN分发 | <https://www.hualigs.cn/> |
| 图像 / 搜图 | Dialogue.moe | <https://dialogue.moe/> |
| 图像 / 搜图 | SauceNAO反向图像搜索 | <https://saucenao.com/> |
| 图像 / 搜图 | TinEye Labs - Multicolr Search Lab | <http://labs.tineye.com/multicolr/> |
| 图像 / 搜图 | Xslist.org - 健康的宅男偶像专题网站 | <https://xslist.org/zh> |
| 图像 / 搜图 | www.animequery.cn | <http://www.animequery.cn/> |
| 图像 / 搜图 | 二维图像高级搜索 | <https://ascii2d.net/> |
| 图像 / 搜图 | 以图搜图 | <https://trace.moe/> |
| 图像 / 搜图 | 图像搜索引擎 | <https://www.everypixel.com/> |
| 图像 / 搜图 | 图片搜索 | <http://www.xuan.cool/picture.html> |
| 图像 / 搜图 | 多服务图像搜索 | <https://3d.iqdb.org/> |
| 图像 / 搜图 | 多服务图像搜索 | <https://iqdb.org/> |
| 图像 / 搜图 | 百度识图, "鉴"你所见 | <https://image.baidu.com/?fr=shitu> |
| 图像 / 搜图 | 首頁 - Pixiv圖片代理 | <https://pixiv.cat/> |
| 图像 / 编辑 | Photopea | <https://www.photopea.com/> |
| 图像 / 编辑 | Picdiet - 极速的在线图片压缩80%图片体积 | <https://www.picdiet.com/zh-cn> |
| 图像 / 编辑 | 免费的 OCR API V2023、在线 OCR、可搜索的 PDF 创建器、本地 OCR 软件 | <https://ocr.space/> |
| 图像 / 编辑 | 在线PS | <https://www.uupoop.com/#/old> |
| 图像 / 编辑 | 在线抠图工具 | <https://www.remove.bg/zh> |
| 图像 / 编辑 | 美图秀秀网页版 | <http://xiuxiu.web.meitu.com/main.html> |
| 格式转换 | EPUB 转 PDF \| CloudConvert | <https://cloudconvert.com/epub-to-pdf> |
| 格式转换 | PDF转Word-免费在线PDF转换成Word转换器 \| 加加PDF官网 - 文电通 | <https://www.addpdf.cn/pdf-to-word> |
| 格式转换 | 免费和在线文件转换器 - ConvertFiles.com | <http://www.convertfiles.com/> |
| 格式转换 | 在线多媒体转换器合集 | <https://cn.office-converter.com/> |
| 格式转换 | 在线文件转换器 | <https://cdkm.com/cn/> |
| 格式转换 | 在线文件转换器 - DocsPal | <https://www.docspal.com/> |
| 格式转换 | 在线表格转换工具 | <https://tableconvert.com/> |
| 格式转换 | 在线视频切割机 - 剪切视频，剪切MP4，AVI，MPG，3GP | <https://online-video-cutter.com/> |
| 格式转换 | 在线超级转换工具 - 免费转换 | <https://www.wdku.net/> |
| 格式转换 | 在线转换图片格式-在线图片转换器-100% 免费 | <https://jinaconvert.com/cn/index.php> |
| 格式转换 | 在线转换文档，图像，视频，音频文件 | <https://www.aconvert.com/cn/> |
| 格式转换 | 电子书格式转换 | <https://toepub.com/zh/> |
| 词典 | FreeMdict Forum - （词典） | <https://forum.freemdict.com/> |
| 词典 | FreeMdict（词典） | <https://freemdict.com/> |
| 词典 | Index of /(词典） | <https://downloads.freemdict.com/> |
| 词典 | 《欧路词典》（词典） | <https://www.eudic.net/v4/en/app/eudic> |

## 素材与音频（76）

| 子类 | 标题 | 网址 |
|---|---|---|
| 免版权视频 | Beautiful, Free Stock Video Footage For Your Homepage | <https://coverr.co/> |
| 免版权视频 | FootageCrate | <https://footagecrate.com/> |
| 免版权视频 | Free Stock Footage Videos, 4k After Effects Templates and More! | <https://www.videezy.com/> |
| 免版权视频 | Free Stock Video Footage & Motion Graphics Download HD & 4K | <https://www.videvo.net/> |
| 免版权视频 | Free stock videos · Pexels Videos | <https://www.pexels.com/videos/> |
| 免版权视频 | Mazwai | <http://mazwai.com/#/> |
| 免版权视频 | Mazwai | <http://mazwai.com/> |
| 免版权视频 | Mixkit - 非凡的免费高清视频 | <https://mixkit.co/> |
| 免版权视频 | 免费正版高清视频素材库 数千部优质视频素材可供免费使用和下载 - Pixabay | <https://pixabay.com/zh/videos/> |
| 免版权视频 | 免费股票视频·像素视频 | <https://www.pexels.com/videos> |
| 免版权视频 | 家-免费影视素材 | <https://www.freestockfootage.com/> |
| 免版权音乐 | BeatPick: Music licensing for Film, Tv and Advertising use (license pre-cleared music) | <http://www.beatpick.com/> |
| 免版权音乐 | Bensound | <https://www.bensound.com/> |
| 免版权音乐 | Free Music Archive | <https://freemusicarchive.org/> |
| 免版权音乐 | Generative.fm | <https://generative.fm/> |
| 免版权音乐 | Jamendo音乐\| 免费音乐下载 | <https://www.jamendo.com/> |
| 免版权音乐 | MUSOPEN | <https://musopen.org/music/> |
| 免版权音乐 | Purple Planet Music | <https://www.purple-planet.com/> |
| 免版权音乐 | Royalty Free Music - Download over 100,000 mp3 files free \| Musopen | <https://musopen.org/music/?__cf_chl_jschl_tk__=7130b3c61c143f7277320305c5084321ae6658ff-1594004517-0-AQKGYGgMgs-35mcp2tDezoTSX2ixGI9QZhOPcApoeswfj0iWM_mxDcOPS81ssQ96TK40aRWPsd0lHTJ7tWaTlUmWfEAl2nlauHNhfdUisGDCFZNmxnSUDvecmawEMj7NnBwQy85PjDdylfho3R9ympxdM6DuYi9C7v_N03ATBXeNwaBQS2CVu1NQYL9skYA-wPBltkyknxzFZyguubxnIg3TdN4Qm3je2__zIs6E488Z_qlSlYzcxbb3_3rEghjxTpxNrS0kiQIr3296b9nVrojhqfGLP93Je0fSbXzXelej80iLCFSUdZBN5ZKWc9lFzF7hld7gYU-8cvC57eT5Twk> |
| 免版权音乐 | Royalty-Free Stock Video and Music Library \| Pond5 | <https://www.pond5.com/> |
| 免版权音乐 | TunePocket | <https://www.tunepocket.com/> |
| 免版权音乐 | perception is circumstantial | <https://cctrax.com/> |
| 免版权音乐 | 下载免费的Bleep音效-Mixkit | <https://mixkit.co/free-sound-effects/bleep/> |
| 免版权音乐 | 下载免费的活页乐谱和乐谱。 | <http://en.scorser.com/D/Sheet+music.html> |
| 免版权音乐 | 免版税音乐和声音效果\| 流行声音 | <https://www.epidemicsound.com/> |
| 免版权音乐 | 古典音乐频道 | <http://www.ncpa-classic.com/> |
| 免版权音乐 | 国际乐谱库：曲谱PDF下载 | <https://cn.imslp.org/wiki/Main_Page> |
| 免版权音乐 | 库存音乐和声音效果\| 音频微 | <https://www.audiomicro.com/> |
| 免版权音乐 | 活页乐谱，免版税和公共领域音乐\| Musopen | <https://musopen.org/?__cf_chl_jschl_tk__=fa7ebb99080331e43ce4f4d9e56324b27f182319-1590376754-0-AfCyS50mC4L1HShqaf1QuZtp-rkb7_xi453YvTWTLOl45Q5aY8y1tHZla9E_Vf3IwAOWj5M6en-aQRPKhcc4-YlnRWSBXYMLd-z-X-NGnGNi277SxLTXh2mX7jgLaMdG9CFLPcZAdH6aviW2Ge1T2OSefIdW_rUu7wVbdkvU8yWb215gt35Zb2CJtfhYRX9UpyjXPBCpTVTUDp9-_5lZhBmDz6d1CwqLJL0cRjEyQQRHi_WUTCMxOabQ94PLdInlKXD9UHmdma7SVTThX1uoFcUvkpzsjy4SQLxI0bsqUXVcstryCOZ804kOzNXzOQeBgUrIBcDkvi7T5Ufhws4RPeU> |
| 免版权音乐 | 版税免费音乐从DL声音 | <https://www.dl-sounds.com/> |
| 免版权音乐 | 版税免费音频库 - 股票音乐，音效和循环 - Storyblocks音频 | <https://www.audioblocks.com/> |
| 图像素材库 | Emoji表情包下载 | <https://emojiisland.com/> |
| 图像素材库 | Emoji表情搜索 | <https://emoji.svend.cc/> |
| 图像素材库 | NASA图片视频素材库 | <https://images.nasa.gov/> |
| 图像素材库 | Pexels图片素材库 | <http://www.pexels.com/> |
| 图像素材库 | Pixabay图片素材库 | <https://pixabay.com/zh/> |
| 图像素材库 | Unsplash图片素材库 | <https://unsplash.com/> |
| 图像素材库 | Wallpaper Abyss壁纸 | <https://wall.alphacoders.com/> |
| 图像素材库 | open source icons | <https://feathericons.com/> |
| 图像素材库 | 免费PNG图片库 | <https://pluspng.com/> |
| 图像素材库 | 免费透明背景图片素材 | <http://pngimg.com/> |
| 图像素材库 | 极简壁纸 | <https://bz.zzzmh.cn/> |
| 图像素材库 | 表情包在线网站 | <https://fabiaoqing.com/> |
| 图像素材库 | 阿里巴巴矢量图标库 | <https://www.iconfont.cn/> |
| 字幕 | 在线免费翻译字幕�! | <https://translate-subtitles.com/zh-CN> |
| 字幕 | 字幕组机翻小助手 | <https://tern.1c7.me/#/> |
| 游戏素材 | 2D 游戏资产商店和免费 - CraftPix.net | <https://craftpix.net/> |
| 游戏素材 | Free vector icons - SVG, PSD, PNG, EPS & Icon Font - Thousands of free icons | <https://www.flaticon.com/> |
| 游戏素材 | Unity 资源商店 | <https://assetstore.unity.com/> |
| 音效 | 500内部特权错误 | <http://soundbible.com/> |
| 音效 | DUST-SOUNDS \| ループ・BGMミュージックや効果音素材がフリー(無料)でダウンロードできるサイト | <http://dust-sounds.com/> |
| 音效 | FindSounds | <https://www.findsounds.com/> |
| 音效 | FindSounds - Sound Types in Chinese | <https://www.findsounds.com/typesChinese.html> |
| 音效 | Freesound-声音浏览 | <https://freesound.org/browse/> |
| 音效 | OpenGameArt.org | <https://opengameart.org/> |
| 音效 | Royalty Free Loops Samples Sounds Wavs Beats Download | <https://www.looperman.com/loops> |
| 音效 | Sound Effects Downloads \| Sounddogs.com | <https://www.sounddogs.com/> |
| 音效 | Soundsnap | <https://www.soundsnap.com/> |
| 音效 | TAM Music Factory - 使用フリーの音楽素材（MP3素材）・効果音素材 | <https://www.tam-music.com/> |
| 音效 | くらげ工匠 | <http://www.kurage-kosho.info/> |
| 音效 | フリーBGM（音楽素材）無料ダウンロード｜DOVA-SYNDROME | <https://dova-s.jp/> |
| 音效 | マンガ文字素材dddFont – 漫画的表現ができる素材をドドドっとストック | <https://dddfont.com/> |
| 音效 | 伴奏网，5SING伴奏 - 中国原创音乐基地 | <http://5sing.kugou.com/bz/index.shtml> |
| 音效 | 免费的免版税音乐— Fugue | <https://icons8.com/music/> |
| 音效 | 免费音效\| SoundJay.com | <https://www.soundjay.com/> |
| 音效 | 効果音源3｜ロイヤリティーフリーの効果音素材をダウンロード | <http://koukaongen.com/> |
| 音效 | 小森平 | <https://taira-komori.jpn.org/freesoundcn.html> |
| 音效 | 尖叫声 | <https://www.findsounds.com/ISAPI/search.dll?keywords=squeal+squealing&keywords=squeal+squealing> |
| 音效 | 按类别浏览 | <https://www.soundsnap.com/browse> |
| 音效 | 爱给网_音效配乐_3D模型_视频素材_游戏素材_免费下载 | <http://www.aigei.com/> |
| 音效 | 站长素材音效下载 | <http://sc.chinaz.com/yinxiao/> |
| 音效 | 音效 音效网 声音网 音效素材 音效下载 游戏音效 - 爱给网 | <http://www.aigei.com/sound/> |
| 音效 | 音效分类音效下载- 商用音效-购买-音效素材 - 100Audio | <https://100audio.com/sound/> |
| 音效 | 音效素材 - 各类音效素材,声音素材下载 - 数码资源网 | <https://www.smzy.com/yinpin/> |
| 音效 | 音效网_音效素材下载_音效素材网_音效库下载_素材吧 | <https://www.sucaibar.com/yinxiao/> |
| 音效 | 音笑网 | <http://www.yisell.com/> |

## 影音与娱乐（183）

| 子类 | 标题 | 网址 |
|---|---|---|
| 动漫 | AcFuns动漫网 - 全网高清动漫在线看 | <https://www.acfuns.net/> |
| 动漫 | AcgnHub - 你的二次元萌导航姬！ | <http://www.acgfans.me/> |
| 动漫 | Bangumi 番组计划 | <https://bgm.tv/> |
| 动漫 | 动漫岛 | <http://www.dmd8.com/> |
| 动漫 | 哈哩哈哩 | <http://halihali.li/acg/> |
| 动漫 | 樱花动漫 | <http://www.yhdm.tv/> |
| 动漫 | 樱花动漫 | <http://m.imomoe.in/> |
| 动漫 | 蜜柑计划 - Mikan Project | <https://mikanani.me/> |
| 动漫 | 趣动漫 | <https://www.qdm66.com/dongmanplay/5647-1-1.html> |
| 动漫 / 漫画 | Yuri漫画 | <https://www.yinmh.com/tags/100780.html> |
| 动漫 / 漫画 | [pixiv] | <https://www.pixiv.net/> |
| 动漫 / 漫画 | 动漫之家漫画网 | <https://manhua.dmzj.com/> |
| 动漫 / 漫画 | 动漫之家（漫画） | <https://www.dmzj.com/> |
| 动漫 / 漫画 | 拷贝漫画 | <https://www.copymanga.site/comics?theme=baihe> |
| 动漫 / 漫画 | 搜漫_一站式漫画搜索引擎 | <https://www.soman.com/> |
| 动漫 / 漫画 | 立读 | <https://tachiyomi.org/> |
| 动漫 / 论坛 | 吱吱物语岛！ | <https://www.ziziu.cn/?__K=18618065abd5ca9d615a917938ba8c0de1610104871_12736> |
| 动漫 / 论坛 | 好萌动漫（原NekoPlus）—— 欢迎大家常来搜集与整理各类漫画、轻音乐、萌图、动漫、游戏等二次元资源！ | <https://www.nicemoe.fun/> |
| 动漫 / 论坛 | 萌幻之乡 | <https://hmoe.top/> |
| 娱乐 | Twitch | <https://www.twitch.tv/> |
| 娱乐 | YouTube | <https://www.youtube.com/feed/trending?bp=6gQJRkVleHBsb3Jl> |
| 娱乐 | 导航 | <https://pipigou708.top/> |
| 小说 | 69书吧 | <https://www.69shuba.com/> |
| 小说 | 69书吧 | <https://www.69shu.xyz/> |
| 小说 | 69书吧 | <https://www.69shu.pro/> |
| 小说 | 69阅读 | <https://www.69yd.top/index.html> |
| 小说 | 69阅读 | <https://www.69yue.top/index.html> |
| 小说 | AO3 | <https://archiveofourown.org/> |
| 小说 | ⚡ 天天看小说 | <https://ttk.tw/> |
| 小说 | 全本免费小说 | <https://m.qbmfxs.com/> |
| 小说 | 台湾小说网 | <https://twkan.com/> |
| 小说 | 得奇小说网 | <https://www.deqixs.com/> |
| 小说 | 爱下电子书_享受阅读的乐趣！ | <https://ixdzs8.com/> |
| 小说 | 程序猿书吧 | <https://www.cxysb.com/> |
| 小说 | 繁体小说网 | <https://www.xiaoshuo.com.tw/870224/> |
| 小说 | 绝对之门-速读谷-魔性沧月小说-最新章节无错字免费阅读 | <https://www.sudugu.org/1945/> |
| 小说 | 茄子搜书 | <https://qiezi.gno.limo/> |
| 小说 | 起点中文网_阅文集团旗下网站_首页 | <https://m.qidian.com/> |
| 小说 | 铅笔小说_最值得书友收藏的网络小说阅读网 | <https://www.23qb.com/> |
| 小说 | 阅读论坛 - Powered by Discuz! | <https://legado.cn/> |
| 小说 / 轻小说 | カクヨム | <https://kakuyomu.jp/> |
| 小说 / 轻小说 | 哔哩轻小说 | <https://m.linovelib.com/> |
| 小说 / 轻小说 | 圖書館的無限迴廊 | <https://epub.love/wp/> |
| 小说 / 轻小说 | 小説家になろう | <https://syosetu.com/> |
| 小说 / 轻小说 | 神凑轻小说 | <http://m.shencou.com/> |
| 小说 / 轻小说 | 神凑轻小说文库 | <http://www.shencou.com/> |
| 小说 / 轻小说 | 轻之国度 | <https://www.lightnovel.us/> |
| 小说 / 轻小说 | 轻之国度-专注分享的NACG社群 | <https://www.lightnovel.us/cn/> |
| 小说 / 轻小说 | 轻之文库轻小说 | <https://www.linovel.net/> |
| 小说 / 轻小说 | 轻书架 | <https://www.acgdmzy.com/#/home> |
| 小说 / 轻小说 | 轻小说文库 | <http://www.wenku8.net/index.php> |
| 小说 / 轻小说 | 魔笔小说 | <https://www.mobinovels.com/> |
| 影视 | 12岁の乐园-12uhun.xyz/12d/ | <https://nnononoyes.wbsaoyy-hee66.yachts/> |
| 影视 | 555电影APP下载-555电影官网永久发布页 | <https://app.jlghjy.com/> |
| 影视 | M3U8在线解析 | <https://m3u8.cachecha.com/> |
| 影视 | M3U8播放器 | <https://m3u8play.com/> |
| 影视 | NO视频 | <https://www.novipnoad.com/> |
| 影视 | Porn Dude | <https://theporndude.com/zh> |
| 影视 | PornFind - 色情搜尋引擎 | <https://www.pornfind.cc/> |
| 影视 | Savieo-保存网络视频 | <https://savieo.com/> |
| 影视 | UAA.COM | <https://www.uaa.com/> |
| 影视 | assrt.net - 字幕下载 | <https://assrt.net/> |
| 影视 | go-search \| 狗狗AV | <https://gogo.pipigou708.top/go-search/%E7%99%BD%E8%99%8E/1/> |
| 影视 | hdzyk,高清资源库 | <https://1080zyk1.com/> |
| 影视 | 低端影视 - 超清在线视频站 | <https://ddrk.me/> |
| 影视 | 司机会所 | <https://loopurl.com/sjhs> |
| 影视 | 弹弹play - 全功能“本地视频+弹幕”播放器 | <https://www.dandanplay.com/> |
| 影视 | 影视资源采集网大合集 | <https://caoniang.com/11396.html?hao.su> |
| 影视 | 探探资源 | <https://apittzy.com/> |
| 影视 | 无名小站VIP视频解析网站_无名小站 | <https://www.administrator5.com/> |
| 影视 | 清纯唯美 - XO福利圖 - 海量图片平台 | <https://mak803-ad398-dke3e.xofulitu765.xyz/arttype/2002/> |
| 影视 | 电影狗 | <http://www.dianyinggou.com/> |
| 影视 | 秘密研究所 - 专属于宅男的秘密网址导航 | <https://m.yanjiusuo51.top/%E7%88%B1%E5%AD%A6%E4%B9%A0/> |
| 影视 | 第一导航 | <https://diyyyy29.xyz/zz/?form=Ndr45&date=202522222> |
| 影视 | 老王论坛 | <https://5mhhae.com/forum.php?x=1025244&x=1025244> |
| 影视 | 茶杯狐 Cupfox | <https://www.cupfox.com/> |
| 游戏 | 丸子君的新基地尊享版教程 | <https://docs.qq.com/aio/DSGdQc3htbFJjSFdO?p=DXpTjzl2kZwBjN7jlRMkRJ> |
| 游戏 / 下载 | Anime Garden | <https://animes.garden/resources/1?type=%E6%B8%B8%E6%88%8F> |
| 游戏 / 下载 | CODEXPCGames | <https://codexpcgames.com/> |
| 游戏 / 下载 | Cкачать игры на ПК | <https://byrut.org/> |
| 游戏 / 下载 | FFF游戏  49423 | <http://aiwan.jifen2345.cn/> |
| 游戏 / 下载 | FitGirl Repack | <https://fitgirl-repack.com/> |
| 游戏 / 下载 | GBT乐赏游戏空间 | <http://gbtgame.ysepan.com/> |
| 游戏 / 下载 | GBT游戏分享 | <https://www.gbtgames.com/> |
| 游戏 / 下载 | IGGGAMES | <https://igg-games.com/> |
| 游戏 / 下载 | Igrovaya.org | <https://igrovaya.org/> |
| 游戏 / 下载 | PCGamesTorrents | <https://pcgamestorrents.com/> |
| 游戏 / 下载 | Repack-Games | <https://repack-games.com/> |
| 游戏 / 下载 | SE7EN.ws | <https://se7en.ws/?lang=en> |
| 游戏 / 下载 | Skidrow & Reloaded Games | <https://www.skidrowreloaded.com/> |
| 游戏 / 下载 | flysheep资源避难所-一个免费的二次元风格下载站 | <https://www.flysheep6.com/> |
| 游戏 / 下载 | 土豆 | <http://www.tdtd.club/> |
| 游戏 / 下载 | 小叽资源 – Free Share | <https://steamzg.com/> |
| 游戏 / 下载 | 电脑游戏洪流下载 | <https://rutor-org.games/> |
| 游戏 / 下载 | 破解在线游戏 | <https://online-fix.me/> |
| 游戏 / 主机游戏 | 26VV - 一个自由分享与下载经典游戏和怀旧游戏的部落 | <https://26vv.com/#> |
| 游戏 / 主机游戏 | Download game | <https://downloadgameps3.com/> |
| 游戏 / 主机游戏 | GameKegs - GKinto | <http://gkinto.com/> |
| 游戏 / 主机游戏 | PPSSPP - psp模拟器 | <http://www.ppsspp.org/index-cn.html> |
| 游戏 / 主机游戏 | ROMSPURE.COM - 新闻和下载 Nintendo 和 Playstation 游戏 | <https://romspure.com/> |
| 游戏 / 主机游戏 | ROMS仓库_模拟MAX | <http://www.emumax.com/roms/> |
| 游戏 / 主机游戏 | RetroArch 是模拟器 | <https://www.retroarch.com/index.php> |
| 游戏 / 主机游戏 | WL.Event Game（模拟器下载） | <https://emulator.sumofents.net/> |
| 游戏 / 主机游戏 | yuzu - Nintendo Switch Emulator | <https://yuzu-emu.org/> |
| 游戏 / 主机游戏 | 游戏下载_游戏资讯 | <http://www.k73.com/tvg/> |
| 游戏 / 主机游戏 | 游戏年轮 | <https://www.bibgame.com/> |
| 游戏 / 主机游戏 | 老男人游戏网 \| OldmanEmu.net | <https://www.oldmanemu.net/> |
| 游戏 / 主机游戏 | 街机游戏_超能街机 | <https://www.mamecn.com/> |
| 游戏 / 主机游戏 | 飞马前端 | <https://pegasus-frontend.org/#downloads> |
| 游戏 / 云游戏 | GeForce NOW | <https://play.geforcenow.com/mall/#/layout/games> |
| 游戏 / 云游戏 | START-腾讯云游戏 | <https://start.qq.com/> |
| 游戏 / 云游戏 | 咪咕快游 | <https://pc.migufun.com/> |
| 游戏 / 云游戏 | 在线 DOS 游戏 | <https://dos.zczc.cz/> |
| 游戏 / 云游戏 | 小霸王，其乐无穷 | <https://www.yikm.net/> |
| 游戏 / 云游戏 | 斗鱼云游戏官网（可网页） | <https://cloudgame.douyu.com/home> |
| 游戏 / 云游戏 | 极云普惠官网 | <https://www.ji-cloud.cn/> |
| 游戏 / 云游戏 | 格来云游戏（可网页） | <https://www.gloud.cn/#/index> |
| 游戏 / 云游戏 | 海星云官网 | <https://www.haixingcloud.com/#/Home> |
| 游戏 / 云游戏 | 网易云游戏平台（可网页） | <https://cg.163.com/#/mobile> |
| 游戏 / 云游戏 | 胖鱼道炫（可网页） | <https://www.anygame.info/> |
| 游戏 / 云游戏 | 蘑菇云游（可网页） | <https://www.moguyouxi.cn/> |
| 游戏 / 云游戏 | 虎牙YOWA云游戏（可网页） | <https://yowa.huya.com/> |
| 游戏 / 云游戏 | 雷电云手机官网 | <https://www.ldyunos.com/#/> |
| 游戏 / 云游戏 | 顺网云电脑（可网页） | <https://cpc.icloud.cn/> |
| 游戏 / 信息 | IsThereAnyDeal(游戏信息) | <https://isthereanydeal.com/search/?q=Post+Scriptum> |
| 游戏 / 信息 | 其乐 Keylol | <https://keylol.com/> |
| 游戏 / 信息 | 匿名专用服务器组件 | <https://steamdb.info/sub/17906/apps/> |
| 游戏 / 信息 | 蒸汽数据库 | <https://steamdb.info/> |
| 游戏 / 加速器 | Golink加速器 | <https://www.golink.com/> |
| 游戏 / 加速器 | Steam++ - 主页 | <https://steampp.net/> |
| 游戏 / 加速器 | Steam++工具箱 | <http://www.steamtool.net/> |
| 游戏 / 加速器 | 奇妙网游加速器 | <https://www.qimiao.com/> |
| 游戏 / 加速器 | 战神游戏加速器 | <https://www.zsspeed.com/> |
| 游戏 / 加速器 | 流星游戏加速器 | <https://www.liuxing.com/> |
| 游戏 / 加速器 | 香肠免费加速器 | <https://www.xiangchang.com/> |
| 游戏 / 模组 | 3DM游戏网 | <https://www.3dmgame.com/> |
| 游戏 / 模组 | 9dm玖大猫游戏mod论坛 | <http://www.9dmdamaomod.net/> |
| 游戏 / 模组 | DLC | <https://patch.moe/> |
| 游戏 / 模组 | FLiNG Trainer | <https://flingtrainer.com/> |
| 游戏 / 模组 | GGNETWORK | <https://ggntw.com/steam> |
| 游戏 / 模组 | GameBuff官网-修改器 | <https://gamebuff.cn/download.html> |
| 游戏 / 模组 | Lewd Patcher - 成人游戏补丁 | <https://lewdpatcher.com/> |
| 游戏 / 模组 | Nexus 模组和社区 | <https://skyrim.nexusmods.com/> |
| 游戏 / 模组 | Skymods | <https://catalogue.smods.ru/> |
| 游戏 / 模组 | WeMod | <https://www.wemod.com/zh> |
| 游戏 / 模组 | 一修大师游戏修改器下载_ | <https://patch.ali213.net/showpatch/154685.html> |
| 游戏 / 模组 | 人物卡 | <https://db.bepis.moe/koikatsu> |
| 游戏 / 模组 | 单机游戏_游侠网 | <https://www.ali213.net/> |
| 游戏 / 模组 | 幻觉游戏卡 | <https://illusioncards.booru.org//index.php?page=post&s=list> |
| 游戏 / 购买 | China Play | <https://chinaplay.store/> |
| 游戏 / 购买 | EA 協助中心：官方支援 | <https://help.ea.com/tw/> |
| 游戏 / 购买 | Electronic Arts | <https://www.ea.com/games/library/pc-download?isLocalized=true> |
| 游戏 / 购买 | Epic Games Store \| Official Site | <https://www.epicgames.com/store/zh-CN/?lang=zh-CN> |
| 游戏 / 购买 | GOG.com | <https://www.gog.com/> |
| 游戏 / 购买 | Gama-Gama | <https://gama-gama.cn/> |
| 游戏 / 购买 | Home \| Riot Games | <https://www.riotgames.com/zh-cn> |
| 游戏 / 购买 | Humble Bundle | <https://www.humblebundle.com/?hmb_source=navbar> |
| 游戏 / 购买 | Origin | <https://www.origin.com/sgp/zh-tw/my-home> |
| 游戏 / 购买 | Plati.Market | <https://plati.market/> |
| 游戏 / 购买 | Riot 账号管理 | <https://account.riotgames.com/account#communication-preferences> |
| 游戏 / 购买 | SteamPY_安全省钱的Steam游戏交易市场 | <https://steampy.com/home> |
| 游戏 / 购买 | SteamrepCN - 首页 | <https://steamrepcn.com/> |
| 游戏 / 购买 | YUPLAY \| You play for less with us! | <https://www.yuplay.com/> |
| 游戏 / 购买 | 下载最新的独立游戏 - itch.io | <https://itch.io/> |
| 游戏 / 购买 | 外星人竞技场 | <https://www.alienwarearena.com/ucf/Giveaway> |
| 游戏 / 购买 | 方块游戏平台 | <https://www.cubejoy.com/> |
| 游戏 / 购买 | 欢迎来到 Steam | <https://store.steampowered.com/> |
| 游戏 / 购买 | 育碧 | <https://store.ubi.com/cn/home> |
| 游戏 / 购买 | 赛睿游戏 | <https://games.steelseries.com/home> |
| 百合 | / \| konachan.com - Konachan.com Anime Wallpapers | <https://konachan.com/post> |
| 百合 | / \| yande.re | <https://yande.re/post> |
| 百合 | Index | <http://index.tsyuri.com/> |
| 百合 | ponpomu Hi！yuriyuri! | <https://www.ponpomu.com/> |
| 百合 | 变身百合小说论坛 | <https://www.bianshenyuri.com/forum.php?forumlist=1&mobile=2> |
| 百合 | 海棠文化线上文学城 | <https://longmabookcn.com/> |
| 百合 | 百合会 | <https://bbs.yamibo.com/forum.php?forumlist=1&mobile=2> |
| 百合 | 百合图 | <https://yuriimg.com/> |
| 百合 | 百合天国哈啦板- 巴哈姆特 | <https://forum.gamer.com.tw/A.php?bsn=60405> |
| 百合 | 百合相关插画特辑一览 | <https://www.pixivision.net/zh/s/?q=%E7%99%BE%E5%90%88> |
| 音乐 | GD音乐台 | <https://music.gdstudio.xyz/> |
| 音乐 | MYFREEMP3 -（音乐下载） | <http://tool.liumingye.cn/music/?page=homePage> |
| 音乐 | Spotify | <https://open.spotify.com/?flow_id=7a47b64d-eb63-4a66-9dab-aa7f20959c42%3A1689714283&creation_point=https%3A%2F%2Fopen.spotify.com%2F%3Fsp_cid%3Dcfdaaccfa5da9b65e796e1a54e878e1e> |
| 音乐 | 无损音乐吧 | <https://www.dtshot.com/> |

