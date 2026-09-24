import { FastifyPluginAsync } from 'fastify';
import { auth } from '../http.js';

const wsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/v1/ws',{websocket:true,preHandler:auth},(socket:any)=>{socket.send(JSON.stringify({type:'hello',serverTime:new Date().toISOString()}));socket.on('message',(raw:Buffer)=>{try{const msg=JSON.parse(raw.toString());if(msg.type==='ping')socket.send(JSON.stringify({type:'pong'}));}catch{socket.send(JSON.stringify({type:'error',message:'Invalid message'}));}});});
};

export default wsRoutes;
