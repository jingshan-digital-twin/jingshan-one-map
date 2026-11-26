-- Imported from CIM服务地址.xlsx, Sheet1. Preserve local edits and removals on restart.
INSERT INTO jingshan_cim_services
    (id, name, category, kind, url, layer, version, default_visible, sort_order, source_sheet, source_row)
VALUES
    ('cim-01', '荆门市1m影像', '基础影像', 'wms', $1 || '/agserver/topp/ows?request=GetCapabilities&service=WMS&version=1.3.0&layers=topp%3Ajms_ygyx_1m', 'topp:jms_ygyx_1m', '1.3.0', true, 10, 'Sheet1', 2),
    ('cim-02', '京山市中心城区白模', '城市模型', '3dtiles', $1 || '/models-rest/rest/models/preview/js_jzbm_jzbmxx_up/tileset.json', '', '', false, 20, 'Sheet1', 3),
    ('cim-03', '京山市中心城区以外的白模', '城市模型', '3dtiles', $1 || '/models-rest/rest/models/preview/jss_fww/tileset.json', '', '', false, 30, 'Sheet1', 4),
    ('cim-04', '京山市道路面', '道路交通', 'wms', $1 || '/agserver/topp/ows?request=GetCapabilities&service=WMS&version=1.3.0&layers=topp%3Ajss_zydc_csdl', 'topp:jss_zydc_csdl', '1.3.0', false, 40, 'Sheet1', 5),
    ('cim-05', '京山市区县级行政区划', '行政区划', 'wms', $1 || '/agserver/topp/ows?request=GetCapabilities&service=WMS&version=1.3.0&layers=topp%3Ajss_skjc_xzq_qxj', 'topp:jss_skjc_xzq_qxj', '1.3.0', false, 50, 'Sheet1', 6),
    ('cim-06', '京山市乡镇级行政区划', '行政区划', 'wms', $1 || '/agserver/topp/ows?request=GetCapabilities&service=WMS&version=1.3.0&layers=topp%3Ajss_skjc_xzq_xzj', 'topp:jss_skjc_xzq_xzj', '1.3.0', false, 60, 'Sheet1', 7),
    ('cim-07', '京山市村社区级行政区划', '行政区划', 'wms', $1 || '/agserver/topp/ows?request=GetCapabilities&service=WMS&version=1.3.0&layers=topp%3Ajss_skjc_xzq_sqcj', 'topp:jss_skjc_xzq_sqcj', '1.3.0', false, 70, 'Sheet1', 8),
    ('cim-08', '京山市社区网格', '行政区划', 'wms', $1 || '/agserver/topp/ows?request=GetCapabilities&service=WMS&version=1.3.0&layers=topp%3Ajss_skjc_xzq_sqwg', 'topp:jss_skjc_xzq_sqwg', '1.3.0', false, 80, 'Sheet1', 9),
    ('cim-09', '京山市学校', '公共服务', 'wfs', $1 || '/agserver/topp/ows?service=wfs&version=1.1.0&request=GetFeature&maxFeatures=1&count=1&outputFormat=application%2Fjson&typeName=topp%3Ajss_jyj_jyxtsjsj&cql_filter=1%3D1', 'topp:jss_jyj_jyxtsjsj', '1.1.0', false, 90, 'Sheet1', 10),
    ('cim-10', '京山市医院卫生院', '公共服务', 'wfs', $1 || '/agserver/topp/ows?service=wfs&version=1.1.0&request=GetFeature&maxFeatures=1&count=1&outputFormat=application%2Fjson&typeName=topp%3Ajss_wjw_wssxx&cql_filter=1%3D1', 'topp:jss_wjw_wssxx', '1.1.0', false, 100, 'Sheet1', 11),
    ('cim-11', '京山市景区', '文旅休闲', 'wfs', $1 || '/agserver/topp/ows?service=wfs&version=1.1.0&request=GetFeature&maxFeatures=1&count=1&outputFormat=application%2Fjson&typeName=topp%3Ajss_wlj_lyjq&cql_filter=1%3D1', 'topp:jss_wlj_lyjq', '1.1.0', false, 110, 'Sheet1', 12),
    ('cim-12', '京山市广场', '文旅休闲', 'wfs', $1 || '/agserver/topp/ows?service=wfs&version=1.1.0&request=GetFeature&maxFeatures=1&count=1&outputFormat=application%2Fjson&typeName=topp%3Ajss_cgj_gcyd&cql_filter=1%3D1', 'topp:jss_cgj_gcyd', '1.1.0', false, 120, 'Sheet1', 13),
    ('cim-13', '京山市公园', '文旅休闲', 'wfs', $1 || '/agserver/topp/ows?service=wfs&version=1.1.0&request=GetFeature&maxFeatures=1&count=1&outputFormat=application%2Fjson&typeName=topp%3Ajss_cgj_gy&cql_filter=1%3D1', 'topp:jss_cgj_gy', '1.1.0', false, 130, 'Sheet1', 14)
ON CONFLICT (id) DO NOTHING;
