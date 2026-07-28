<?php

function sp_config()
{
	static $cfg = null;
	if( $cfg === null )
		$cfg = require __DIR__ . '/config.php';
	return $cfg;
}

function sp_base_url()
{
	$scheme = ( !empty( $_SERVER['HTTPS'] ) && $_SERVER['HTTPS'] !== 'off' ) ? 'https' : 'http';
	if( !empty( $_SERVER['HTTP_X_FORWARDED_PROTO'] ) )
		$scheme = $_SERVER['HTTP_X_FORWARDED_PROTO'];
	return $scheme . '://' . $_SERVER['HTTP_HOST'];
}

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
	if( $bPartial )
	{
		header( 'HTTP/1.1 206 Partial Content' );
		header( 'Content-Range: bytes ' . $iStart . '-' . $iEnd . '/' . $iSize );
	}

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

function sp_cached_crc32( $sZipPath )
{
	$sCachePath = $sZipPath . '.crc';
	$iMtime = filemtime( $sZipPath );
	$iSize = filesize( $sZipPath );

	if( is_file( $sCachePath ) )
	{
		$cache = json_decode( file_get_contents( $sCachePath ), true );
		if( is_array( $cache ) && ( $cache['mtime'] ?? null ) === $iMtime && ( $cache['size'] ?? null ) === $iSize )
			return $cache['crc32'] ?? '';
	}

	$iCrc = hash_file( 'crc32b', $sZipPath );
	if( $iCrc === false )
		return '';

	file_put_contents( $sCachePath, json_encode( [
		'mtime' => $iMtime,
		'size'  => $iSize,
		'crc32' => $iCrc,
	] ) );

	return $iCrc;
}
