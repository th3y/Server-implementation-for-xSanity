<?php

set_time_limit( 0 );

$cfg = require __DIR__ . '/config.php';

$aMime = [
	'mpg'   => 'video/mpeg',
	'mpeg'  => 'video/mpeg',
	'mp4'   => 'video/mp4',
	'avi'   => 'video/x-msvideo',
	'webm'  => 'video/webm',
	'mkv'   => 'video/x-matroska',
	'mov'   => 'video/quicktime',
	'flv'   => 'video/x-flv',
	'f4v'   => 'video/x-flv',
	'ogv'   => 'video/ogg',
	'wmv'   => 'video/x-ms-wmv',
	'nobga' => 'application/octet-stream',
];

function sp_safe_basename( $sName )
{
	$sName = strtolower( basename( $sName ) );
	if( $sName === '' || $sName === '.' || $sName === '..' )
		return null;
	if( strpos( $sName, '..' ) !== false || strpos( $sName, '/' ) !== false || strpos( $sName, '\\' ) !== false )
		return null;
	return $sName;
}

function sp_serve_file( $sFullPath, $sContentType, $iThrottleKBps )
{
	$iSize = filesize( $sFullPath );
	$iStart = 0;
	$iEnd = $iSize - 1;
	$bPartial = false;

	if( !empty( $_SERVER['HTTP_RANGE'] ) && preg_match( '/bytes=(\d*)-(\d*)/', $_SERVER['HTTP_RANGE'], $m ) )
	{
		if( $m[1] !== '' )
			$iStart = (int)$m[1];
		if( $m[2] !== '' )
			$iEnd = (int)$m[2];
		if( $iStart > $iEnd || $iEnd >= $iSize )
		{
			header( 'HTTP/1.1 416 Range Not Satisfiable' );
			header( 'Content-Range: bytes */' . $iSize );
			exit;
		}
		$bPartial = true;
	}

	$iLength = $iEnd - $iStart + 1;

	header( 'Content-Type: ' . $sContentType );
	header( 'Accept-Ranges: bytes' );
	header( 'Content-Length: ' . $iLength );
	header( 'Cache-Control: public, max-age=31536000' );
	if( $bPartial )
	{
		header( 'HTTP/1.1 206 Partial Content' );
		header( 'Content-Range: bytes ' . $iStart . '-' . $iEnd . '/' . $iSize );
	}

	if( $_SERVER['REQUEST_METHOD'] === 'HEAD' )
		exit;

	$f = fopen( $sFullPath, 'rb' );
	fseek( $f, $iStart );

	$iChunk = 65536;
	if( $iThrottleKBps > 0 )
		$iChunk = max( 1024, (int)( $iThrottleKBps * 1024 / 10 ) );

	$iRemaining = $iLength;
	while( $iRemaining > 0 && !feof( $f ) )
	{
		$iRead = min( $iChunk, $iRemaining );
		echo fread( $f, $iRead );
		flush();
		$iRemaining -= $iRead;
		if( $iThrottleKBps > 0 && $iRemaining > 0 )
			usleep( 100000 );
	}
	fclose( $f );
}

if( $_SERVER['REQUEST_METHOD'] !== 'GET' && $_SERVER['REQUEST_METHOD'] !== 'HEAD' )
{
	http_response_code( 405 );
	exit;
}

$sPath = parse_url( $_SERVER['REQUEST_URI'], PHP_URL_PATH );
$sName = sp_safe_basename( $sPath );
if( $sName === null )
{
	http_response_code( 404 );
	exit;
}

$sExt = pathinfo( $sName, PATHINFO_EXTENSION );
if( !isset( $aMime[$sExt] ) )
{
	http_response_code( 404 );
	exit;
}

$sFullPath = __DIR__ . '/videos/' . $sName;
if( !is_file( $sFullPath ) )
{
	$sBase = substr( $sName, 0, -( strlen( $sExt ) + 1 ) );
	$sNobgaPath = __DIR__ . '/videos/' . $sBase . '.nobga';
	if( is_file( $sNobgaPath ) )
	{
		header( 'Location: /' . rawurlencode( $sBase ) . '.nobga', true, 302 );
		exit;
	}
	http_response_code( 404 );
	exit;
}

sp_serve_file( $sFullPath, $aMime[$sExt], $cfg['throttle_kbps'] );
