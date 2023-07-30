import * as vscode from 'vscode';
import { basename, dirname, join, resolve } from 'path';
import axios from 'axios';
import { endianness } from 'os';
import { open, readFileSync } from 'fs';
import { existsSync,mkdirSync, writeFileSync, promises as fsPromises } from 'fs';

interface ArticleTitle {
	name: string;  // 文章名字
	type: string;  // 是否发布
    id : String; // 文章id
}

// 目录
export interface ArticleToc {
	resource?: vscode.Uri;
	isDirectory: boolean;
	title: string;
	id?: string,
}


export class ArticleTocModel {
	// cats : cat -> [titles]
	// titleMap: title -> id
	// titlePath: title -> path
	constructor(
		private context:vscode.ExtensionContext,
		private path:string,
		private cookie:string,
		private cats:Map<string,string[]>,
		private titleMap:Map<string,string>,
		private titlePath:Map<string,string>,
		private titleCat:Map<string,string>) {
	}

	private async inputCookie() {
		var cookie = null;
		while (!cookie) {
			cookie = await vscode.window.showInputBox({
				placeHolder: "输入cookie",
			});
		}
		this.cookie = cookie;
		this.context.globalState.update("cookie",cookie);
	}

	private loadAndGetCats():Thenable<ArticleToc[]> {
		var cookie:string|undefined = this.context.globalState.get("cookie")
		if (!cookie) {
			this.inputCookie()
		}
		if (cookie) {
			this.cookie = cookie
		}
		console.log("cookie this cookie",this.cookie)
		const config = {
			headers:{
				"Cookie":this.cookie,
			}
		}
		this.titlePath.clear()
		this.cats.clear()
		this.titleCat.clear()
		this.titleMap.clear()
		console.log("config",config)
		return axios.get('https://www.qxgzone.com/api/admin/article/edit/list',config).
		then(res=>{	
			if (res.data.code == 10003 ) {
				vscode.window.showInformationMessage("need login")
				this.inputCookie();
				vscode.window.showInformationMessage("已更新cookie,请刷新")
				return
				// 重新运行
			}
			// 博客数据在这里
			var articleDatas:object = res.data.data;
			console.log("get list:",articleDatas)
			for (const [cat,value] of Object.entries(articleDatas)) {
				var articles :object = value;
				var titles = [];
				for (const article of Object.values(articles)) {
					var id =this.getDataValue('_id',article);
					var title = this.convertTitle(this.getDataValue('title',article),id);
					var filePath = join(this.path,cat + "/" + title + ".md")
					this.titleMap.set(title,id);
					titles.push(title);
					//this.loadOneEditArticle(id);
					this.titlePath.set(title,filePath)
					this.titleCat.set(title,cat)
				}
				this.cats.set(cat,titles);
			}
		}).then(()=>{
			this.context.globalState.update("cats",JSON.stringify(Array.from(this.cats)));
			this.context.globalState.update("titleMap",JSON.stringify(Array.from(this.titleMap)));
			this.context.globalState.update("titlePath",JSON.stringify(Array.from(this.titlePath)));
			console.log("global state is",this.context.globalState)
			return this.getCats()
		})
	}


	// 加载编辑版本地数据到本地
	public async loadOneEditArticle(id: string){
		const config = {
			headers:{
				"Cookie":this.cookie,
			}
		}
		await axios.get("https://www.qxgzone.com/api/admin/article/get/"+id,config).then(res=> {
			var content = res.data.data.content
			var title = this.convertTitle(res.data.data.title,id)
			var cat = res.data.data.catagory
			if (!cat) {
				cat = "未分类"
			}
			// 先创建目录
			var dir = join(this.path,cat);
			if (!existsSync(dir)){
				mkdirSync(dir)
			}
			// 将数据写入到 path/cat/title.md下
			var articlePath = this.titlePath.get(title)
			if (!articlePath) {
				articlePath = join(this.path,cat + "/" + title + ".md")
				this.titlePath.set(title,articlePath)
			}
			console.log(articlePath)
			if (!content) {
				content = ""
			}
			writeFileSync(articlePath,content)
		})
	}

	private convertTitle(title:string,id?:string):string{
		if (!title && id) {
			return id;
		}
		return title.replace("\/","_")
	}

	// 根据返回获取分类
	private getCats(): ArticleToc[] {
		var datas = [];
		for (const [key,value] of this.cats){
			datas.push({
				isDirectory:true,
				title:key,
			});
		};
		return datas;
	}

	private getDataValue(key:string,data:object) : string {
		let res = "";
		Object.entries(data).find(([ikey,value])=> {
			if (key === ikey) {
				res = value;
				return true;
			}
			return false;
		});
		return res;
	}

	// 根据分类获取内部所有文章及标题
	private getInnerTitle(cat: string): ArticleToc[] {
		var titles = this.cats.get(cat);
		if (titles == undefined) {
			return []
		}
		var datas = [];
		for (const title of titles) {
			var articlePath = this.titlePath.get(title)
			var id = this.titleMap.get(title)
			if (articlePath == undefined || id == undefined) {
				continue
			}
			datas.push({
				resource:vscode.Uri.file(articlePath),
				isDirectory:false,
				title:title,
				id: id,
			});
		}
		return datas;
	}

    // 获取顶级节点
	public get roots(): Thenable<ArticleToc[]> {
		return this.loadAndGetCats()
	}

    // 获取子节点
	public getChildren(node: ArticleToc): Thenable<ArticleToc[]> {
		return Promise.resolve(this.getInnerTitle(node.title));
	}

	public async saveArtilce(title:string,content:string) {
		console.log(title,content)
		var cat = this.titleCat.get(title)
		var id = this.titleMap.get(title)
		if (!cat || !id) {
			console.error("未找到关键信息")
			return
		}
		await axios.put('https://www.qxgzone.com/api/admin/article/'+id,
			{
				"title":title,
				"catagory":cat,
				"content":content,
			}
		,{
			headers:{
				"Cookie":this.cookie,
			}
		}).then(res=> {
			if (res.data.code !=0) {
				vscode.window.showErrorMessage(res.data.msg)
			} else {
				vscode.window.showInformationMessage("保存成功")
			}
		})
	}

	public async releaseArtilce(title:string,content:string) {
		console.log(title,content)
		var cat = this.titleCat.get(title)
		var id = this.titleMap.get(title)
		if (!cat || !id) {
			console.error("未找到关键信息")
			return
		}
		await axios.put('https://www.qxgzone.com/api/admin/article/publish/'+id,
			{
				"title":title,
				"catagory":cat,
				"content":content,
			}
		,{
			headers:{
				"Cookie":this.cookie,
			}
		}).then(res=>{
			if (res.data.code !=0) {
				vscode.window.showErrorMessage(res.data.msg)
			} else {
				vscode.window.showInformationMessage("发布成功")
			}
		})
	}

	public async deleteArtilce(title:string) {
		var id = this.titleMap.get(title)
		if (!id) {
			console.error("未找到关键信息")
			return
		}
		await axios.delete('https://www.qxgzone.com/api/admin/article/'+id,
		{
			headers:{
				"Cookie":this.cookie,
			}
		}).then(res=>{
			if (res.data.code !=0) {
				vscode.window.showErrorMessage(res.data.msg)
			} else {
				vscode.window.showInformationMessage("删除成功")
			}
		})
	}

	public async addArtilce(title:string,cat: string) {
		await axios.post('https://www.qxgzone.com/api/admin/article',
			{},
			{
				headers:{
					"Cookie":this.cookie,
				}
			}).then(async res=> {
				console.log("res",res)
				let id = res.data.data;
				await axios.put('https://www.qxgzone.com/api/admin/article/'+id,
				{
					"title":title,
					"catagory":cat,
					"content":"",
				}
				,{
					headers:{
						"Cookie":this.cookie,
					}
				});
		});
		vscode.window.showInformationMessage("添加成功,请刷新");
	}
}


// 目录生产者
export class ArticleTocTreeDataProvider implements vscode.TreeDataProvider<ArticleToc>, vscode.TextDocumentContentProvider {

	private _onDidChangeTreeData: vscode.EventEmitter<any> = new vscode.EventEmitter<any>();
	readonly onDidChangeTreeData: vscode.Event<any> = this._onDidChangeTreeData.event;

	constructor(private readonly model:ArticleTocModel) { }

    // 刷新时调用
	public refresh(): any {
		this._onDidChangeTreeData.fire(undefined);
	}

    // 根据item， map到视图
	public getTreeItem(element:ArticleToc): vscode.TreeItem {
		return {
			resourceUri: element.resource,
			collapsibleState: element.isDirectory ? vscode.TreeItemCollapsibleState.Collapsed : void 0,
			command: element.isDirectory ? void 0 : {
				command: 'qxgblog.openarticle',
				arguments: [element.id,element.resource],
				title: 'Open article'
			},
			label:element.title
		};
	}

	public async loadFile(id :string) {
		await this.model.loadOneEditArticle(id)
	}

    // 初次进来目录的时候，获取所有一级节点
	public getChildren(element?:ArticleToc): ArticleToc[] | Thenable<ArticleToc[]> {
		return element ? this.model.getChildren(element) : this.model.roots;
	}

	public getParent(element: ArticleToc): ArticleToc | undefined {
		if (element.resource == undefined) {
			return ;
		}
		const parent = element.resource.with({ path: dirname(element.resource.path) });
		return parent.path !== '//' ? { resource: parent, isDirectory: true,title:"test2" } : undefined;
	}

	public provideTextDocumentContent(uri: vscode.Uri, token: vscode.CancellationToken): vscode.ProviderResult<string> {
		console.log("test")
        return "test";
	}

	public async saveArticle(title :string,content:string) {
		await this.model.saveArtilce(title,content)
	}

	public async releaseArticle(title :string,content:string) {
		await this.model.releaseArtilce(title,content)
	}

	public async deleteArticle(title :string) {
		await this.model.deleteArtilce(title)
	}

	public async addArticle() {
		console.log("add is")
		let title = await vscode.window.showInputBox({
			placeHolder:"输入标题",
		});
		if (!title) {
			title = ""
		}
		let cat = await vscode.window.showInputBox({
			placeHolder:"输入分类",
		});
		if (!cat) {
			cat = ""
		}

		await this.model.addArtilce(title,cat)
	}
}

export class ArticleTocExplorer {
	output: vscode.OutputChannel;
	context: vscode.ExtensionContext;
	private ftpViewer: vscode.TreeView<ArticleToc>;
	private provider:ArticleTocTreeDataProvider;

	constructor(context: vscode.ExtensionContext) {
		this.output = vscode.window.createOutputChannel("blog manager");
		this.context = context;
		// 更新文章到本地
		// 获取文章保留地址
		let path: string | undefined = context.globalState.get("BLOG_PATH");
		if (!path || path === '') {
      		path = vscode.workspace.workspaceFolders?.[0].uri.path || __dirname;
      		context.globalState.update("BLOG_PATH", path);
    	}
		this.output.appendLine(`缓存目录：${path}`);
		console.log(path)

		/* Please note that login information is hardcoded only for this example purpose and recommended not to do it in general. */
		const model = new ArticleTocModel(context,path, '',  new Map,new Map,new Map(),new Map());
		const treeDataProvider = new ArticleTocTreeDataProvider(model);
		this.provider = treeDataProvider;
		context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('qxgblog', treeDataProvider));
		this.ftpViewer = vscode.window.createTreeView('qxgblog', { treeDataProvider });


		vscode.commands.registerCommand('qxgblog.refresh', () => treeDataProvider.refresh());
		vscode.commands.registerCommand('qxgblog.add', () => treeDataProvider.addArticle());
		vscode.commands.registerCommand('qxgblog.openarticle', (id,resource)=> this.openResource(id,resource));
		vscode.commands.registerCommand('qxgblog.save', (uri:vscode.Uri)=>{
			var title = basename(uri.fsPath,".md")
			vscode.workspace.fs.readFile(uri).then(data=> {
				this.provider.saveArticle(title,data.toString())
			})
		} );
		vscode.commands.registerCommand('qxgblog.release', (uri:vscode.Uri)=>{
			var title = basename(uri.fsPath,".md")
			vscode.workspace.fs.readFile(uri).then(data=> {
				this.provider.releaseArticle(title,data.toString())
			})
		} );
		vscode.commands.registerCommand('qxgblog.delete', async (uri:vscode.Uri)=>{
			var title = basename(uri.fsPath,".md")
			const selection = await vscode.window.showInformationMessage("确认删除标题为{ " + title + " }的文章吗","是","否")
			console.log("选择",selection)
			if (selection == "是") {
				this.provider.deleteArticle(title).then(()=>{
					this.closeFileIfOpen(uri)
				})
			}
		} );

	}

	private closeFileIfOpen(file:vscode.Uri){
    	const tabs: vscode.Tab[] = vscode.window.tabGroups.all.map(tg => tg.tabs).flat();
    	const index = tabs.findIndex(tab => tab.input instanceof vscode.TabInputText && tab.input.uri.path === file.path);
    	if (index !== -1) {
        	vscode.window.tabGroups.close(tabs[index]);
    	}
}

	private  openResource(id:string,resource: vscode.Uri): void {
		this.provider.loadFile(id).then(() => {
			// 关闭其他
			vscode.workspace.openTextDocument(resource).then(doc=>{
				vscode.commands.executeCommand('workbench.action.closeActiveEditor');
				vscode.window.showTextDocument(doc)
			}).then(()=>{
				vscode.commands.executeCommand("markdown.showLockedPreviewToSide",resource)
			})
		})
		//vscode.workspace.openTextDocument(resource);
	}

	private async reveal(): Promise<void> {
		const node = this.getNode();
		if (node) {
			return this.ftpViewer.reveal(node);
		}
	}

	private getNode(): ArticleToc | undefined {
		if (vscode.window.activeTextEditor) {
			if (vscode.window.activeTextEditor.document.uri.scheme === 'ftp') {
				return { resource: vscode.window.activeTextEditor.document.uri, isDirectory: false ,title:"test"};
			}
		}
		return undefined;
	}
}