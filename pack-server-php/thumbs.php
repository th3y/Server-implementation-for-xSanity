<?php
require __DIR__ . '/common.php';

$aMime = [
	'png'  => 'image/png',
	'jpg'  => 'image/jpeg',
	'jpeg' => 'image/jpeg',
	'gif'  => 'image/gif',
	'bmp'  => 'image/bmp',
];

$sName = sp_safe_basename( $_GET['file'] ?? '' );
$sExt = $sName !== null ? strtolower( pathinfo( $sName, PATHINFO_EXTENSION ) ) : '';

if( $sName === null || !isset( $aMime[$sExt] ) )
{
	http_response_code( 404 );
	exit;
}

$sFullPath = __DIR__ . '/thumbs/' . $sName;
if( !is_file( $sFullPath ) )
{
	http_response_code( 404 );
	exit;
}

header( 'Cache-Control: public, max-age=31536000' );
sp_serve_file( $sFullPath, $aMime[$sExt], 0 );
