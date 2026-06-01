<?php

namespace App\Services\Mobile;

use App\Models\PsgcBarangay;
use App\Models\PsgcCity;
use App\Models\PsgcProvince;
use App\Models\PsgcRegion;

class LocationService
{
    public function list(string $level, ?string $parentId = null, ?string $query = null): array
    {
        $search = trim((string) $query);

        $builder = match ($level) {
            'region' => PsgcRegion::query()->orderBy('name'),
            'province' => PsgcProvince::query()->where('regionId', $parentId)->orderBy('name'),
            'city' => PsgcCity::query()->where('provinceId', $parentId)->orderBy('name'),
            'barangay' => PsgcBarangay::query()->where('cityId', $parentId)->orderBy('name'),
            default => null,
        };

        if ($builder === null) {
            return ['ok' => false, 'status' => 400, 'error' => 'level must be one of region, province, city, barangay'];
        }

        if ($level !== 'region' && empty($parentId)) {
            return ['ok' => false, 'status' => 400, 'error' => 'parentId is required'];
        }

        if ($search !== '') {
            $builder->whereRaw('lower("name") like ?', ['%' . mb_strtolower($search) . '%']);
        }

        return [
            'ok' => true,
            'items' => $builder->limit(100)->get()->map(fn ($row) => [
                'id' => $row->id,
                'code' => $row->code,
                'name' => $row->name,
                'shortName' => $row->shortName ?? null,
                'isCity' => isset($row->isCity) ? (bool) $row->isCity : null,
            ])->all(),
        ];
    }
}
