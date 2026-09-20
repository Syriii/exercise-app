<script setup>
defineProps({ name: String });
const paths = {
 today: 'M3 10 12 3l9 7M5 9v11h5v-6h4v6h5V9',
 food: 'M4 3v6c0 3 6 3 6 0V3M7 3v18M16 3c-3 4-3 9 2 9V3 21',
 train: 'm6 5-3 3m5-1-5 5m9-9L7 8m10 8-5 5m9-9-5 5m-5-7 5 5M16 3l5 5M3 16l5 5',
 history: 'M3 11a9 9 0 1 1 2 7M3 4v7h7m2-4v5l3 2',
 user: 'M20 21a8 8 0 0 0-16 0M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
 camera: 'M4 6h4l2-3h4l2 3h4a1 1 0 0 1 1 1v13H3V7a1 1 0 0 1 1-1m12 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
 image: 'M3 3h18v18H3Zm0 13 6-6 8 11m-4-4 4-4 4 4M16 7h.01',
 plus: 'M12 5v14M5 12h14', check: 'm5 12 4 4L19 6', arrow: 'm9 5 7 7-7 7', back: 'm15 5-7 7 7 7', close: 'm6 6 12 12M6 18 18 6',
 search: 'M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0m-2 4 6 6', more: 'M5 12h.01M12 12h.01M19 12h.01', clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0m-9-5v5l3 2',
 leaf: 'M20 3C7 2 1 7 5 16c9 4 15-2 15-13ZM3 21 16 8', settings: 'm10 3-1 3-3 1-3-1-1 4 3 2v3l-2 2 3 3 3-2 3 1 2 3 4-2-1-3 2-2h3v-4l-3-1-1-3 1-3-4-2-2 2Zm5 9a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
 scale: 'M5 3h14l3 18H2Zm3 4h8l-1 5H9Zm4 0v3', edit: 'm15 4 5 5M4 15 16 3l5 5L9 20l-6 1Z', star: 'm12 3 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z',
 trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7', calendar: 'M3 5h18v16H3ZM7 3v4m10-4v4M3 11h18', bell: 'M5 17V9a7 7 0 0 1 14 0v8l2 2H3Zm5 5h4',
 shield: 'm12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6Zm-4 9 3 3 5-6', download: 'M12 3v12m-5-5 5 5 5-5M3 16v5h18v-5', sun: 'M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1m-3 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0', info: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0m-9-1v6m0-10h.01', refresh: 'M20 8A9 9 0 0 0 4 6L2 9m0-6v6h6m-4 7a9 9 0 0 0 16 2l2-3m0 6v-6h-6', minus: 'M5 12h14', logout: 'M9 3H3v18h6m6-16 6 7-6 7M8 12h13', list: 'M8 5h13M8 12h13M8 19h13M3 5h.01M3 12h.01M3 19h.01',
};
</script>
<template><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="paths[name] || paths.leaf" /></svg></template>
