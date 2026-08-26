import 'dart:convert';
import 'package:http/http.dart' as http;
class ApiException implements Exception { final String message; ApiException(this.message); }
class Api { final String base; String? token; Api(this.base);
 Map<String,String> get headers=>{'Content-Type':'application/json',if(token!=null)'Authorization':'Bearer $token'};
 Future<dynamic> request(String path,{String method='GET',Map<String,dynamic>? body}) async { final uri=Uri.parse('$base$path'); final r=await switch(method){'POST'=>http.post(uri,headers:headers,body:body==null?null:jsonEncode(body)),'PATCH'=>http.patch(uri,headers:headers,body:body==null?null:jsonEncode(body)),'DELETE'=>http.delete(uri,headers:headers),'GET'=>http.get(uri,headers:headers),_=>http.get(uri,headers:headers)}; if(r.statusCode>=300)throw ApiException(r.body); return r.body.isEmpty?null:jsonDecode(r.body); }
 Future<Map<String,dynamic>> login(String login,String password) async {final x=await request('/auth/login',method:'POST',body:{'login':login,'password':password});token=x['token'];return Map<String,dynamic>.from(x['user']);}
 Future<List<dynamic>> searches()=>request('/searches').then((x)=>List<dynamic>.from(x));
 Future<List<dynamic>> tasks(String id)=>request('/searches/$id/tasks').then((x)=>List<dynamic>.from(x));
 Future<List<dynamic>> gps(String id)=>request('/searches/$id/gps').then((x)=>List<dynamic>.from(x));
 Future<void> join(String id)=>request('/searches/$id/join',method:'POST');
 Future<void> taskStatus(String id,String status)=>request('/tasks/$id',method:'PATCH',body:{'status':status});
 Future<void> sendGps(String id,List<Map<String,dynamic>> points)=>request('/searches/$id/gps',method:'POST',body:{'points':points});
}
