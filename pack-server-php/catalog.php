<?php
require __DIR__ . '/common.php';

$cfg = sp_config();
$sRoot = __DIR__;

$sStaticCatalog = $sRoot . '/catalog.json.static';
if( is_file( $sStaticCatalog ) )
{
	header( 'Content-Type: application/json' );
	header( 'Cache-Control: no-cache' );
	readfile( $sStaticCatalog );
	exit;
}

$sBase = sp_base_url();
$packs = [];

foreach( glob( $sRoot . '/packs/*.zip' ) as $sZipPath )
{
	$sId = basename( $sZipPath, '.zip' );

	$pack = [
		'id'      => $sId,
		'name'    => $sId,
		'size'    => filesize( $sZipPath ),
		'url'     => $sBase . '/packs/' . rawurlencode( $sId ) . '.zip',
		'type'    => 'songpackage',
		'version' => '1.0.0',
	];

	$sMetaPath = $sRoot . '/packs/' . $sId . '.json';
	if( is_file( $sMetaPath ) )
	{
		$meta = json_decode( file_get_contents( $sMetaPath ), true );
		if( is_array( $meta ) )
		{
			if( !empty( $meta['name'] ) )
				$pack['name'] = $meta['name'];
			if( !empty( $meta['author'] ) )
				$pack['author'] = $meta['author'];
			if( isset( $meta['songs'] ) )
				$pack['songs'] = (int)$meta['songs'];
			if( ( $meta['type'] ?? '' ) === 'userpackage' )
				$pack['type'] = 'userpackage';
			if( !empty( $meta['version'] ) )
				$pack['version'] = $meta['version'];
		}
	}

	$sCrc = sp_cached_crc32( $sZipPath );
	if( $sCrc !== '' )
		$pack['crc32'] = $sCrc;

	foreach( [ 'png', 'jpg', 'jpeg' ] as $sExt )
	{
		$sThumbPath = $sRoot . '/thumbs/' . $sId . '.' . $sExt;
		if( is_file( $sThumbPath ) )
		{
			$pack['image'] = $sBase . '/thumbs/' . rawurlencode( $sId ) . '.' . $sExt;
			break;
		}
	}

	$packs[] = $pack;
}

header( 'Content-Type: application/json' );
header( 'Cache-Control: no-cache' );
echo json_encode( [
	'name'  => $cfg['catalog_name'],
	'packs' => $packs,
], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES );
