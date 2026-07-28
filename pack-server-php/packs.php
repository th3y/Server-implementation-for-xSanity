<?php
require __DIR__ . '/common.php';

set_time_limit( 0 );

$cfg = sp_config();

$sName = sp_safe_basename( $_GET['file'] ?? '' );
if( $sName === null || substr( $sName, -4 ) !== '.zip' )
{
	http_response_code( 404 );
	exit;
}

$sFullPath = __DIR__ . '/packs/' . $sName;
if( !is_file( $sFullPath ) )
{
	http_response_code( 404 );
	exit;
}

header( 'Cache-Control: public, max-age=31536000' );
sp_serve_file( $sFullPath, 'application/zip', $cfg['throttle_kbps'] );
