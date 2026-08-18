// ECharts is loaded via <script> tag in index.html (public/vendor/echarts.min.js)
// to avoid Rollup tree-shaking breaking chart registrations in production builds.
const echarts = window.echarts;
export default echarts;
