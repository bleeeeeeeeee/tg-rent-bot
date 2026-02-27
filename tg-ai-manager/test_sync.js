const BotService=require('./services/BotService');
const PostRepository=require('./services/PostRepository');
(async()=>{
 const bs=new BotService(PostRepository);
 await bs.prefixReady;
 const samples={
   1:{message_id:1,media_group_id:'grpA',text:'hello',date:Date.now()},
   2:{message_id:2,media_group_id:'grpA',text:'world',date:Date.now()},
   3:{message_id:3,reply_to_message:{message_id:1},text:'reply',date:Date.now()},
   4:{message_id:4,text:'solo',date:Date.now()},
   5:{message_id:5,media_group_id:'grpB',text:'foo',date:Date.now()},
 };
 bs.bot.copyMessage = async (a,b,id) => {
   if(samples[id]) return samples[id];
   throw new Error('notfound');
 };
 const hr=require('./services/HistoryRepository');
 await hr._write({records:[]});
 console.log('running first sync');
 await bs.syncHistory(true);
 console.log('history after sync', await hr.getAll());
 console.log('removing 4 and 5');
 delete samples[4]; delete samples[5];
 await bs.syncHistory(true);
 console.log('history after deletion sync', await hr.getAll());
 bs.bot.stopPolling();
})();