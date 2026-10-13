export const DATA_PATH='data/atlas.json';
const SERVICE='https://travel-atlas-publish-warren.neoncorgi.chatgpt.site';

export class PasswordClient {
  #password='';
  #fetch;
  constructor(fetcher=fetch){this.#fetch=fetcher.bind(globalThis);}
  get unlocked(){return !!this.#password;}
  lock(){this.#password='';}
  async request(path,body){
    let response;
    try{response=await this.#fetch(SERVICE+path,{method:body?'POST':'GET',cache:'no-store',signal:AbortSignal.timeout(25000),...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});}
    catch(error){throw Error(['TimeoutError','AbortError'].includes(error?.name)?'发布请求超时。草稿仍在本机，请先检查云端结果再重新发布。':'暂时无法连接发布服务，草稿仍保存在本机。');}
    let result;try{result=await response.json();}catch{throw Error('发布服务返回了无效数据，请稍后重试。');}
    if(!response.ok)throw Error(result.error||'发布服务暂时不可用（'+response.status+'）。');
    return result;
  }
  async unlock(password){
    if(typeof password!=='string'||!password)throw Error('请输入管理密码。');
    const result=await this.request('/api/auth',{password});
    if(result.authenticated!==true)throw Error('服务器未确认管理身份。');
    this.#password=password;
  }
  async read(path){
    if(path!==DATA_PATH)throw Error('不支持读取这个文件。');
    const result=await this.request('/api/atlas');
    if(!result.document||typeof result.revision!=='string')throw Error('服务器返回的地图记录不完整。');
    return {data:result.document,sha:result.revision};
  }
  async write(path,data,sha){
    if(path!==DATA_PATH)throw Error('不支持发布这个文件。');
    if(!this.unlocked)throw Error('请先输入管理密码。');
    const result=await this.request('/api/atlas',{password:this.#password,document:data,baselineRevision:sha,requestId:crypto.randomUUID()});
    if(result.published!==true||!result.document||typeof result.revision!=='string')throw Error('服务器未确认发布成功。');
    return {data:result.document,sha:result.revision};
  }
}
