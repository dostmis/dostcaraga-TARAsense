<?php

namespace App\Models;

class PsgcCity extends PrismaModel
{
    protected $table = 'psgc_cities';

    public $incrementing = false;
    protected $keyType = 'string';
    public $timestamps = false;

    protected $fillable = ['id', 'code', 'name', 'isCity', 'provinceId'];

    protected $casts = [
        'isCity' => 'boolean',
    ];

    public function province()
    {
        return $this->belongsTo(PsgcProvince::class, 'provinceId');
    }

    public function barangays()
    {
        return $this->hasMany(PsgcBarangay::class, 'cityId');
    }

    public function userProfiles()
    {
        return $this->hasMany(UserProfile::class, 'cityId');
    }

    public function studyTargets()
    {
        return $this->hasMany(StudyLocationTarget::class, 'cityId');
    }
}
