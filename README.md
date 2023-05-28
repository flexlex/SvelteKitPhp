# Sveltekit - PHP


## Introduction
Since today i used adapter static for PHP sites (due to hosting only providing that option). And manually editing the prerendered HTML file or adding my custom API Endpoints.  
This project aims to blend Sveltekit and PHP and keep all that magic of svelte (preloads and ssr <sup>**</sup>).

## Install

#### NPM
```sh
npm i --save-dev sveltekit-php
```

#### PNPM
```sh
pnpm add -D sveltekit-php
```

## Setup

### Adapter
In your svelte.config.js import the adapter
```js
import adapter from "sveltekit-php";
```

### Root Layout
In order to corrctly use the PHP-Adapter, you should put this code into your root +layout.server.js.
```js
export const prerender = true;
export const ssr = true;
export const trailingSlash = "always";
```

- **prerender**: is necessary to create the HTML/PHP file
- **ssr**: is necessary to fetch data on request and for preloading data
- **trailingSlash**: is needed to generate a _path/index.php_ file instead of a _path.php_ file.

## Usage

### Step 1
Create a +page.server.php or +layout.server.php  
Where you would normally use a *+page.server.js* or *+layout.server.js*, you can use a *+page.server.php* or a *+layout.server.php* file.

<sub>(Note: layout.server.php fetches all parent data and can _not_ be resetted.)</sub>

### Step 2
Write your load function.  
```php
<?php
function load($param){
    $routeid = $param["routeid"];
    $parentdata = $param["parentdata"];

    return [
        "message" => "Hello by PHP Server"
    ];
}
?>
```

## Missing features
*Planed to be implemented*
- Streaming data
- Form actions

*Don't know how to fix yet*
- First SSR render with correct data
- Live preview (Vite)

*Not planing to implement it*
- Reset layout


## What about those <sup>**</sup> ? 😒
Preloads work fine, but since the pages are prerendered the default data (in +page.server.js if you choose to use them) can be seen for a split second.  
The server generated data (by PHP) is already inlined into the document to be rendered as fast as possible.  
  
Maybe **you** have the solution to this problem.