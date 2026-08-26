import 'dart:convert';
import 'package:path/path.dart';
import 'package:sqflite/sqflite.dart';
class LocalDb { static Database? _db; Future<Database> get db async { if(_db!=null)return _db!; final p=join(await getDatabasesPath(),'kukla.db');_db=await openDatabase(p,version:1,onCreate:(d,v)async{await d.execute('CREATE TABLE cache(k TEXT PRIMARY KEY,v TEXT NOT NULL)');await d.execute('CREATE TABLE queue(id INTEGER PRIMARY KEY AUTOINCREMENT,type TEXT NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL)');});return _db!; }
 Future<void> put(String k,dynamic v)async{final d=await db;await d.insert('cache',{'k':k,'v':jsonEncode(v)},conflictAlgorithm:ConflictAlgorithm.replace);}
 Future<dynamic> get(String k)async{final d=await db;final r=await d.query('cache',where:'k=?',whereArgs:[k]);return r.isEmpty?null:jsonDecode(r.first['v'] as String);}
 Future<void> enqueue(String type,Map<String,dynamic> payload)async{final d=await db;await d.insert('queue',{'type':type,'payload':jsonEncode(payload),'created_at':DateTime.now().toUtc().toIso8601String()});}
 Future<List<Map<String,dynamic>>> queue()async{final d=await db;return (await d.query('queue',orderBy:'id')).map((x)=>{'id':x['id'],'type':x['type'],'payload':jsonDecode(x['payload'] as String)}).toList();}
 Future<void> remove(int id)async{final d=await db;await d.delete('queue',where:'id=?',whereArgs:[id]);}
}
