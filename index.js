import path, { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import glob from 'tiny-glob';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';

/** 
 * @param {object} options
 * @param {boolean} [options.ssr=true]
 * @param {string} [options.out="./build/"] - Build path relative to svelte.config.js file
 * @param {string} [options.assets="./build/"] - Asset path relative to svelte.config.js
 * @param {string} [options.polyfill=true] - If should use polyfills
 * @param {boolean} [options.precompress=false] - If should use polyfills
 * @param {boolean} [options.strict=true] - If should use polyfills
 * 
 */

const files = fileURLToPath((new URL(import.meta.url)).href);

export default function ({ssr=true,out="./build/",assets="./build/",polyfill=true,precompress=false,fallback=false,strict=false}={}) {
	return {
		name: '@flexlex/sveltekit-php-adapter',

		async adapt(builder) {
            if (!fallback) {
				if (builder.routes.some((route) => route.prerender !== true) && strict !== false) {
					const prefix = path.relative('.', builder.config.kit.files.routes);
					const has_param_routes = builder.routes.some((route) => route.id.includes('['));
					const config_option =
						has_param_routes || JSON.stringify(builder.config.kit.prerender.entries) !== '["*"]'
							? `  - adjust the \`prerender.entries\` config option ${
									has_param_routes
										? '(routes with parameters are not part of entry points by default)'
										: ''
							  } — see https://kit.svelte.dev/docs/configuration#prerender for more info.`
							: '';

					builder.log.error(
						`@sveltejs/adapter-static: all routes must be fully prerenderable, but found the following routes that are dynamic:
${builder.routes.map((route) => `  - ${path.posix.join(prefix, route.id)}`).join('\n')}

You have the following options:
  - set the \`fallback\` option — see https://kit.svelte.dev/docs/single-page-apps#usage for more info.
  - add \`export const prerender = true\` to your root \`+layout.js/.ts\` or \`+layout.server.js/.ts\` file. This will try to prerender all pages.
  - add \`export const prerender = true\` to any \`+server.js/ts\` files that are not fetched by page \`load\` functions.
${config_option}
  - pass \`strict: false\` to \`adapter-static\` to ignore this error. Only do this if you are sure you don't need the routes in question in your final app, as they will be unavailable. See https://github.com/sveltejs/kit/tree/master/packages/adapter-static#strict for more info.

If this doesn't help, you may need to use a different adapter. @sveltejs/adapter-static can only be used for sites that don't need a server for dynamic rendering, and can run on just a static file server.
See https://kit.svelte.dev/docs/page-options#prerender for more details`
					);
					throw new Error('Encountered dynamic routes');
				}
			}

            const tmpDir = builder.getBuildDirectory("svelte-php");
            
            // Cleanup
            builder.log.minor("Cleaning build and temp directory");
            builder.rimraf(out);
            builder.rimraf(assets);
            builder.rimraf(tmpDir);
            builder.mkdirp(tmpDir);

            // Write client
            builder.log.minor("Copying Assets");
            const writtenClientFiles = builder.writeClient(`${assets}`);

            if(ssr){
                const startFilePath = writtenClientFiles.find(a=>/entry\/start(.*)\.js$/.test(a));
                if(startFilePath){
                    let startFile = await readFile(startFilePath,"utf8");
                    await writeFile(startFilePath,startFile.replace("__data.json","__data.php"),"utf8");
                    console.log("SUBSTITUITION MADE TO ",startFilePath);
                }
            }
            
            // Pages
            builder.log.minor("Creating Pages");
            builder.writePrerendered(`${tmpDir}/prerendered`);

            // Convert HTML Files to PHP
            builder.log.minor("Finding PHP Server Scripts");
            const routesBasePath = "src/routes/";
            
            const layoutPHPs =(await Promise.all([glob(routesBasePath+"**/+layout.server.php")])).flat(1).filter(a=>a).map(a=>a.replace(routesBasePath,"/").replace("+layout.server.php",""));
            const pagePHPs = (await glob(routesBasePath+"**/+page.server.php")).map(a=>a.replace(routesBasePath,"/"));
            
            let pageDep = "";
            let layoutDep = [];
            let usedDepedencies = new Set();
            const serverMap = new Map();
            const serverFunctionName = new Map();

            
            function prepareDataFile(dependencies=[],nav_path){
                builder.log.minor("Generating Data Loader for "+nav_path);

                let p = "./";
                const ns = nav_path.split("/").filter(a=>a);

                const c = ns.length;
                for(let i = c; --i>=0;){
                    p+="../";
                }

                const includes = [];
                const load_fx = [];
                let fd = "";
                let fn = "";
                dependencies.forEach(d=>{
                    fd = "_protected"+d.replace("+layout.server.php","_layout.php").replace("+page.server.php","_page.php");
                    fn = d.replace(".server.php",".php").replace(/\//g,"_").replace("+","").replace(".php","_load").replace(/(\(|\)|\.|\,\+\-)/g,"");
                    serverMap.set(d,fd);
                    serverFunctionName.set(d,fn);
                    includes.push(`include("${p+fd}");`);
                    load_fx.push(`if(function_exists("${fn}")){
    $res = ${fn}([
        "routeid"=>"${nav_path}",
        "parentdata"=>$basedata
    ]);
}else{
    $res = null;
}
if($res){
    $subres[] = ["type"=>"data","data"=>$res];
    foreach($res as $k=>$v){
        $basedata[$k] = $v;
    }
}
`);
                });

                return [
                    "<?php",
                    "",
                    includes.join("\r\n"),
                    "",
                    "$basedata=[];",
                    "$subres=[];",
                    "",
                    load_fx.join("\r\n"),
                    "",
                    "$json_data_result=json_encode($subres);",
                    "if(array_key_exists(\"x-sveltekit-invalidated\",$_GET)){",
`$new_res_nodes = [[]];
$new_res_nodes_index = 0;
foreach($res as $k=>$v){
    $new_res_nodes[0][$k] = ++$new_res_nodes_index;
    $new_res_nodes[] = $v;
}`,
`$new_res = [
    "type"=>"data",
    "nodes"=>[[
        "type"=>"data",
        "data"=>$new_res_nodes,
        "uses"=>[]
    ]]
];`,
                    "  echo json_encode($new_res);",
                    "}",
                    "",
                    "?>"
                ].join("\r\n");
            };

            for(let [navPath,filePath] of builder.prerendered.pages){
                builder.log.minor("Generating Path: "+navPath);
                pageDep = pagePHPs.find(a=>a==navPath+"+page.server.php");
                layoutDep = layoutPHPs.filter(a=>{
                    return navPath.indexOf(a)===0;
                }).map(a=>a+"+layout.server.php");
                let dependencies = layoutDep.concat(pageDep).filter(a=>a);
                dependencies.forEach(a=>usedDepedencies.add(a));

                if(dependencies.length){
                    let htmlFilePath = `${tmpDir}/prerendered/${filePath.file}`;
                    let fileContent = await readFile(htmlFilePath,"utf8")+"";
                    if(ssr){
                        fileContent = "<?php include(\"./__data.php\");?>\r\n"+fileContent.replace(/const data = \[.*\];/i,"const data = <?php echo $json_data_result; ?>");
                    }
                    await writeFile(htmlFilePath,fileContent,"utf8");
                    await writeFile(`${tmpDir}/prerendered${navPath}/__data.php`,prepareDataFile(dependencies,navPath),"utf8");
                    await unlink(`${tmpDir}/prerendered${navPath}/__data.json`);
                    if(ssr){
                        await rename(htmlFilePath,`${tmpDir}/prerendered/${filePath.file.replace(".html",".php")}`);
                    }
                }
            }

            builder.log.minor("Converting server functions");

            let p = [];

            async function convertServerFile(baseO,fileO,baseD,fileD){
                let original_server_function = await readFile(baseO+fileO,"utf8");
                builder.mkdirp(resolve(baseD+"/"+fileD,"../"));
                if(serverFunctionName.has(fileO)){
                    original_server_function = original_server_function.replace("function load(",`function ${serverFunctionName.get(fileO)}(`)
                }
                await writeFile(baseD+"/"+fileD,original_server_function,"utf8");
            }

            for(let [file_name,new_name] of serverMap){
                builder.log.minor("Converting: file_name");
                p.push(convertServerFile(routesBasePath,file_name,tmpDir+"/prerendered/",new_name))
            }

            await Promise.all(p);
            builder.log.minor("Server convertion finished");

            builder.log.minor("Creating build");
            builder.copy(`${tmpDir}/prerendered/`,out);

		}
	};
}